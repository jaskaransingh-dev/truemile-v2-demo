import { Router } from 'express';
import brokerOutreachService from '../services/ai/broker-outreach.service';
import GmailSendService from '../services/gmail/gmail-send.service';
import { prisma } from '../lib/prisma';

const router = Router();

router.get('/broker-rankings', async (req, res) => {
  try {
    const brokers = await prisma.$queryRaw`
      SELECT 
        b.name as broker_name,
        b.email as broker_email,
        COUNT(l.id)::int as total_loads,
        SUM(l.gross_amount)::numeric as total_revenue,
        (SUM(l.gross_amount) / NULLIF(SUM(l.miles), 0))::numeric as avg_rpm,
        MAX(l.pickup_at) as last_load_date,
        (SELECT l2.pickup_location FROM loads l2 WHERE l2.broker_id = b.id AND l2.pickup_location IS NOT NULL GROUP BY l2.pickup_location ORDER BY COUNT(*) DESC LIMIT 1) as top_pickup,
        (SELECT l2.dropoff_location FROM loads l2 WHERE l2.broker_id = b.id AND l2.dropoff_location IS NOT NULL GROUP BY l2.dropoff_location ORDER BY COUNT(*) DESC LIMIT 1) as top_dropoff
      FROM brokers b
      INNER JOIN loads l ON l.broker_id = b.id
      WHERE l.miles > 0 AND l.gross_amount > 0
      GROUP BY b.id, b.name, b.email
      HAVING COUNT(l.id) > 0
      ORDER BY avg_rpm DESC
      LIMIT 50
    `;

    const ranked = brokers
      .map((b: any) => ({
        brokerName: b.broker_name,
        brokerEmail: b.broker_email || `contact@${b.broker_name.toLowerCase().replace(/\s+/g, '')}.com`,
        totalLoads: parseInt(b.total_loads),
        totalRevenue: parseFloat(b.total_revenue || 0),
        avgRPM: parseFloat(b.avg_rpm || 0),
        lastLoadDate: b.last_load_date,
        topPickup: b.top_pickup,
        topDropoff: b.top_dropoff
      }))
      .filter(broker => {
        const emailDomain = broker.brokerEmail.split('@')[1];
        return emailDomain && emailDomain.length <= 40;
      });

    res.json({ success: true, brokers: ranked });
  } catch (error) {
    console.error('Error fetching broker rankings:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch broker rankings' });
  }
});

router.post('/draft', async (req, res) => {
  try {
    const { candidateId, driverName, truckInfo, trailerInfo } = req.body;

    if (!candidateId) {
      return res.status(400).json({
        success: false,
        error: 'candidateId is required'
      });
    }

    const candidates = await prisma.$queryRaw`
      SELECT * FROM load_candidates WHERE id = ${candidateId}
    `;

    if (!candidates || candidates.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Load candidate not found'
      });
    }

    const candidate = candidates[0];

    const subject = `Load Opportunity: ${candidate.pickup_city}, ${candidate.pickup_state} → ${candidate.drop_city}, ${candidate.drop_state}`;
    
    const body = `Hi${candidate.broker ? ` ${candidate.broker}` : ''} Team,

I came across your load posting and wanted to reach out immediately.

LOAD DETAILS:
* MC: 048737
* Origin: ${candidate.pickup_city}, ${candidate.pickup_state}
* Destination: ${candidate.drop_city}, ${candidate.drop_state}
* Pickup: ${candidate.pickup_at ? new Date(candidate.pickup_at).toLocaleDateString() : 'TBD'}
* Delivery: ${candidate.delivery_at ? new Date(candidate.delivery_at).toLocaleDateString() : 'TBD'}
* Distance: ${candidate.miles || 'TBD'} miles
* Rate: $${candidate.rate?.toLocaleString() || 'TBD'} ($${candidate.rpm || 'TBD'}/mile)

ASSIGNED EQUIPMENT:
* Driver: ${driverName || 'TBD'}
* Truck: ${truckInfo || 'TBD'}
* Trailer: ${trailerInfo || 'TBD'}

OUR CAPABILITIES:
* Fleet: 3 Freightliner Cascadia 126 trucks
* Equipment: 2 reefer units, 1 dry van  
* Coverage: Comprehensive service across TX to ME
* Insurance: $1,000,000 coverage per occurrence

We're ready to move this load with reliable, on-time service. Can we get this covered?

Best regards,
Harpreet Dhaliwal
Fleet Manager
Royal Carriers Inc.
royalcarrier3@gmail.com
(469) 394-7061`;

    const draft = await prisma.outreachDraft.create({
      data: {
        brokerName: candidate.broker || 'Unknown Broker',
        recipientEmail: 'harpreet@truemile.ai',
        subject,
        body,
        emailType: 'load_opportunity',
        reasoning: `Load opportunity - Score: ${candidate.score}/100, Driver: ${driverName}`,
        status: 'approved'
      }
    });

    const result = await GmailSendService.sendFromFirstAccount({
      to: draft.recipientEmail,
      subject: draft.subject,
      body: draft.body
    });

    if (result.success) {
      await prisma.outreachDraft.update({
        where: { id: draft.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          gmailMessageId: result.messageId
        }
      });
    }

    res.json({
      success: true,
      draft,
      sent: result.success,
      message: result.success ? 'Email sent!' : 'Draft created'
    });

  } catch (error) {
    console.error('Error creating draft:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create email draft'
    });
  }
});


router.get('/targets', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;

    const brokers = await prisma.brokerStats.findMany({
      orderBy: [
        { totalLoads: 'desc' },
        { avgRatePerMile: 'desc' }
      ],
      take: 50
    });

    const brokerData = brokers.map(b => ({
      name: b.broker,
      email: b.brokerEmail || `contact@${b.broker.toLowerCase().replace(/\s+/g, '')}.com`,
      totalLoads: b.totalLoads,
      avgRate: b.avgRatePerMile || 0,
      topLanes: (b.topLanes as string[]) || [],
      relationshipScore: b.relationshipScore,
      lastLoadDate: b.lastContactDate
    }));

    const topTargets = brokerOutreachService.getTopOutreachTargets(brokerData, limit);

    res.json({
      success: true,
      count: topTargets.length,
      targets: topTargets
    });

  } catch (error) {
    console.error('Error fetching outreach targets:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch outreach targets'
    });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const { brokerName } = req.body;

    if (!brokerName) {
      return res.status(400).json({
        success: false,
        error: 'brokerName is required'
      });
    }

    const brokerQueryResult = await prisma.$queryRaw`
      SELECT 
        b.name as broker_name,
        b.email as broker_email,
        COUNT(l.id)::int as total_loads,
        AVG(l.gross_amount / NULLIF(l.miles, 0))::numeric as avg_rpm
      FROM brokers b
      INNER JOIN loads l ON l.broker_id = b.id
      WHERE b.name = ${brokerName}
      GROUP BY b.id, b.name, b.email
      LIMIT 1
    `;

    if (!brokerQueryResult || brokerQueryResult.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Broker not found'
      });
    }

    const broker = brokerQueryResult[0];

    const brokerData = {
      name: broker.broker_name,
      email: broker.broker_email || `contact@${broker.broker_name.toLowerCase().replace(/\s+/g, '')}.com`,
      totalLoads: broker.total_loads,
      avgRate: parseFloat(broker.avg_rpm) || 0,
      topLanes: [],
      relationshipScore: 50,
      lastLoadDate: new Date()
    };

    const draft = await brokerOutreachService.generateOutreachEmail(brokerData);

    const savedDraft = await prisma.outreachDraft.create({
      data: {
        brokerName: broker.broker_name,
        recipientEmail: brokerData.email,
        subject: draft.subject,
        body: draft.body,
        emailType: draft.type,
        reasoning: draft.reasoning,
        status: 'draft'
      }
    });

    res.json({
      success: true,
      draft: savedDraft
    });

  } catch (error) {
    console.error('Error generating email:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate email'
    });
  }
});

router.post('/generate-batch', async (req, res) => {
  try {
    const { limit = 5 } = req.body;

    const brokers = await prisma.brokerStats.findMany({
      orderBy: [
        { totalLoads: 'desc' },
        { avgRatePerMile: 'desc' }
      ],
      take: 50
    });

    const brokerData = brokers.map(b => ({
      name: b.broker,
      email: b.brokerEmail || `contact@${b.broker.toLowerCase().replace(/\s+/g, '')}.com`,
      totalLoads: b.totalLoads,
      avgRate: b.avgRatePerMile || 0,
      topLanes: (b.topLanes as string[]) || [],
      relationshipScore: b.relationshipScore,
      lastLoadDate: b.lastContactDate
    }));

    const topTargets = brokerOutreachService.getTopOutreachTargets(brokerData, limit);

    const drafts = await brokerOutreachService.generateBatchOutreach(topTargets);

    const savedDrafts = await Promise.all(
      drafts.map(draft =>
        prisma.outreachDraft.create({
          data: {
            brokerName: draft.broker,
            recipientEmail: topTargets.find(t => t.name === draft.broker)?.email || '',
            subject: draft.subject,
            body: draft.body,
            emailType: draft.type,
            reasoning: draft.reasoning,
            status: 'draft'
          }
        })
      )
    );

    res.json({
      success: true,
      count: savedDrafts.length,
      drafts: savedDrafts
    });

  } catch (error) {
    console.error('Error generating batch emails:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate batch emails'
    });
  }
});

router.get('/drafts', async (req, res) => {
  try {
    const drafts = await prisma.outreachDraft.findMany({
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      count: drafts.length,
      drafts
    });

  } catch (error) {
    console.error('Error fetching drafts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch drafts'
    });
  }
});

router.patch('/drafts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { subject, body, status } = req.body;

    const updated = await prisma.outreachDraft.update({
      where: { id: parseInt(id) },
      data: {
        ...(subject && { subject }),
        ...(body && { body }),
        ...(status && { status })
      }
    });

    res.json({
      success: true,
      draft: updated
    });

  } catch (error) {
    console.error('Error updating draft:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update draft'
    });
  }
});

router.post('/drafts/:id/send', async (req, res) => {
  try {
    const { id } = req.params;

    const draft = await prisma.outreachDraft.findUnique({
      where: { id: parseInt(id) }
    });

    if (!draft) {
      return res.status(404).json({
        success: false,
        error: 'Draft not found'
      });
    }

    if (draft.status !== 'approved' && draft.status !== 'sent') {
      return res.status(400).json({
        success: false,
        error: 'Draft must be approved before sending'
      });
    }

    const result = await GmailSendService.sendFromFirstAccount({
      to: draft.recipientEmail,
      subject: draft.subject,
      body: draft.body
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to send email'
      });
    }

    const updated = await prisma.outreachDraft.update({
      where: { id: parseInt(id) },
      data: {
        status: 'sent',
        sentAt: new Date(),
        gmailMessageId: result.messageId
      }
    });

    await updateBrokerConversation(draft.brokerName, draft.recipientEmail);

    res.json({
      success: true,
      draft: updated,
      messageId: result.messageId
    });

  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send email'
    });
  }
});

router.post('/drafts/:id/schedule-followup', async (req, res) => {
  try {
    const { id } = req.params;
    const { daysUntilFollowup = 3 } = req.body;

    const originalDraft = await prisma.outreachDraft.findUnique({
      where: { id: parseInt(id) }
    });

    if (!originalDraft) {
      return res.status(404).json({
        success: false,
        error: 'Original draft not found'
      });
    }

    if (originalDraft.status !== 'sent') {
      return res.status(400).json({
        success: false,
        error: 'Can only schedule follow-up for sent emails'
      });
    }

    if (originalDraft.repliedAt) {
      return res.status(400).json({
        success: false,
        error: 'Broker already replied - no follow-up needed'
      });
    }

    const followUpSubject = `Re: ${originalDraft.subject}`;
    const followUpBody = `Hi,

I wanted to follow up on my previous email about working with Royal Carriers.

${originalDraft.body.split('\n\n')[0]}

Have you had a chance to review? I'd love to discuss how we can support your freight needs.

Looking forward to hearing from you.

Best regards,
Royal Carriers Inc.`;

    const followUpDraft = await prisma.outreachDraft.create({
      data: {
        brokerName: originalDraft.brokerName,
        recipientEmail: originalDraft.recipientEmail,
        subject: followUpSubject,
        body: followUpBody,
        emailType: 'follow_up',
        reasoning: `Automated follow-up after ${daysUntilFollowup} days of no response`,
        status: 'draft',
        isFollowUp: true,
        parentDraftId: originalDraft.id
      }
    });

    res.json({
      success: true,
      followUpDraft
    });

  } catch (error) {
    console.error('Error scheduling follow-up:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to schedule follow-up'
    });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const [totalDrafts, totalSent, totalReplied, recentSent] = await Promise.all([
      prisma.outreachDraft.count(),
      prisma.outreachDraft.count({ where: { status: 'sent' } }),
      prisma.outreachDraft.count({ where: { repliedAt: { not: null } } }),
      prisma.outreachDraft.findMany({
        where: { status: 'sent' },
        orderBy: { sentAt: 'desc' },
        take: 10
      })
    ]);

    const replyRate = totalSent > 0 ? (totalReplied / totalSent) * 100 : 0;

    res.json({
      success: true,
      stats: {
        totalDrafts,
        totalSent,
        totalReplied,
        replyRate: replyRate.toFixed(1),
        recentSent
      }
    });

  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stats'
    });
  }
});

router.delete('/drafts/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.outreachDraft.delete({
      where: { id: parseInt(id) }
    });

    res.json({
      success: true,
      message: 'Draft deleted'
    });

  } catch (error) {
    console.error('Error deleting draft:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete draft'
    });
  }
});

async function updateBrokerConversation(brokerName: string, brokerEmail: string) {
  try {
    const existing = await prisma.brokerConversation.findUnique({
      where: {
        brokerName_brokerEmail: {
          brokerName,
          brokerEmail
        }
      }
    });

    if (existing) {
      await prisma.brokerConversation.update({
        where: {
          brokerName_brokerEmail: {
            brokerName,
            brokerEmail
          }
        },
        data: {
          lastOutreach: new Date(),
          totalOutreach: { increment: 1 }
        }
      });
    } else {
      await prisma.brokerConversation.create({
        data: {
          brokerName,
          brokerEmail,
          lastOutreach: new Date(),
          totalOutreach: 1,
          status: 'active'
        }
      });
    }
  } catch (error) {
    console.error('Error updating broker conversation:', error);
  }
}

export default router;