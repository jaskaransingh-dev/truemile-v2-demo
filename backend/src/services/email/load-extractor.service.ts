// load-extractor.service.ts
// Enhanced load extractor with priority scoring and broker intelligence

import { prisma } from '../db';

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

interface CompanyPreferences {
  minRatePerMile: number;
  preferredStates: string[];
  preferredEquipment: string[];
  maxDistance: number;
  homeBase: string;
}

interface LoadData {
  loadNumber?: string;
  originCity?: string;
  originState?: string;
  destCity?: string;
  destState?: string;
  rate?: number;
  miles?: number;
  ratePerMile?: number;
  equipment?: string;
  weight?: number;
  pickupDate?: Date;
  deliveryDate?: Date;
  commodity?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  confidence: number;
}

export class LoadExtractorService {
  private prefs: CompanyPreferences;

  constructor(prefs: CompanyPreferences) {
    this.prefs = prefs;
  }

  /**
   * NEW: Extract from message and save to database with priority scoring
   */
  async extractFromMessage(message: any): Promise<void> {
    try {
      // Check if it's a load offer
      if (!this.isLoadOffer(message.subject, message.body || '')) {
        return;
      }

      // Extract load data using existing logic
      const loadData = this.extractLoad(
        message.id,
        message.subject,
        message.body || '',
        message.from
      );

      if (!loadData || loadData.confidence < 25) {
        return;
      }

      // Extract broker info
      const broker = this.extractBrokerName(message.subject, message.fromName);
      
      // Build origin and destination strings
      const origin = loadData.originState 
        ? (loadData.originCity ? `${loadData.originCity}, ${loadData.originState}` : loadData.originState)
        : null;
      
      const destination = loadData.destState
        ? (loadData.destCity ? `${loadData.destCity}, ${loadData.destState}` : loadData.destState)
        : null;

      // Calculate priority score
      const scoring = this.calculatePriorityScore({
        origin,
        destination,
        distance: loadData.miles,
        ratePerMile: loadData.ratePerMile,
        equipment: loadData.equipment
      });

      // Save to database
      await prisma.load.create({
        data: {
          messageId: message.id,
          origin,
          destination,
          distance: loadData.miles,
          totalRate: loadData.rate,
          ratePerMile: loadData.ratePerMile,
          equipment: loadData.equipment,
          weight: loadData.weight?.toString(),
          pickupDate: loadData.pickupDate,
          deliveryDate: loadData.deliveryDate,
          broker,
          brokerEmail: message.from,
          brokerPhone: loadData.contactPhone,
          priorityScore: scoring.score,
          fitReason: scoring.reason
        }
      });

      console.log(`✅ Extracted load from ${broker || 'broker'}: ${origin} → ${destination} (Score: ${scoring.score})`);

      // Update broker stats
      if (broker) {
        await this.updateBrokerStats(broker);
      }

    } catch (error) {
      console.error('Error extracting loads from message:', error);
    }
  }

  /**
   * NEW: Calculate priority score based on company preferences
   */
  private calculatePriorityScore(load: {
    origin: string | null;
    destination: string | null;
    distance: number | null | undefined;
    ratePerMile: number | null | undefined;
    equipment: string | null | undefined;
  }): { score: number; reason: string } {
    let score = 0;
    const reasons: string[] = [];

    // Rate scoring (40 points)
    if (load.ratePerMile) {
      if (load.ratePerMile >= this.prefs.minRatePerMile + 1) {
        score += 40;
        reasons.push(`Excellent rate ($${load.ratePerMile.toFixed(2)}/mi)`);
      } else if (load.ratePerMile >= this.prefs.minRatePerMile) {
        score += 25;
        reasons.push(`Good rate ($${load.ratePerMile.toFixed(2)}/mi)`);
      } else if (load.ratePerMile >= this.prefs.minRatePerMile - 0.25) {
        score += 10;
        reasons.push(`Below target rate`);
      }
    }

    // Lane scoring (30 points)
    const originState = load.origin?.match(/\b([A-Z]{2})\b/)?.[1];
    const destState = load.destination?.match(/\b([A-Z]{2})\b/)?.[1];

    if (originState && this.prefs.preferredStates.includes(originState)) {
      score += 15;
      reasons.push(`Preferred origin (${originState})`);
    }
    if (destState && this.prefs.preferredStates.includes(destState)) {
      score += 15;
      reasons.push(`Preferred destination (${destState})`);
    }

    // Equipment scoring (20 points)
    if (load.equipment) {
      const matchesEquipment = this.prefs.preferredEquipment.some(eq =>
        load.equipment!.toLowerCase().includes(eq.toLowerCase())
      );
      if (matchesEquipment) {
        score += 20;
        reasons.push(`Equipment match (${load.equipment})`);
      }
    }

    // Distance scoring (10 points)
    if (load.distance) {
      if (load.distance <= this.prefs.maxDistance) {
        score += 10;
        reasons.push(`Good distance (${load.distance} mi)`);
      } else if (load.distance <= this.prefs.maxDistance * 1.5) {
        score += 5;
      }
    }

    return {
      score: Math.min(score, 100),
      reason: reasons.join('; ') || 'No match criteria'
    };
  }

  /**
   * NEW: Extract broker name from subject or sender
   */
  private extractBrokerName(subject: string, fromName?: string): string | null {
    const text = `${subject} ${fromName || ''}`;
    
    const brokerPatterns = [
      /from\s+([A-Z][A-Za-z\s&]+(?:Logistics|Freight|Transport|Shipping|Carrier))/i,
      /([A-Z][A-Za-z\s&]+(?:Logistics|Freight|Transport|Shipping|Carrier))/i
    ];

    for (const pattern of brokerPatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return fromName || null;
  }

  /**
   * NEW: Update broker statistics and relationship score
   */
  private async updateBrokerStats(brokerName: string): Promise<void> {
    try {
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Get all loads for this broker
      const allLoads = await prisma.load.findMany({
        where: { broker: brokerName },
        select: {
          extractedAt: true,
          ratePerMile: true,
          origin: true,
          destination: true,
          brokerEmail: true
        }
      });

      if (allLoads.length === 0) return;

      // Count loads by time period
      const loadsThisWeek = allLoads.filter(l => l.extractedAt >= oneWeekAgo).length;
      const loadsThisMonth = allLoads.filter(l => l.extractedAt >= oneMonthAgo).length;

      // Calculate average rate
      const ratesPerMile = allLoads
        .map(l => l.ratePerMile)
        .filter(r => r !== null) as number[];

      const avgRatePerMile = ratesPerMile.length > 0
        ? ratesPerMile.reduce((a, b) => a + b, 0) / ratesPerMile.length
        : null;

      const highestRate = ratesPerMile.length > 0 ? Math.max(...ratesPerMile) : null;
      const lowestRate = ratesPerMile.length > 0 ? Math.min(...ratesPerMile) : null;

      // Calculate top lanes
      const laneMap = new Map<string, { count: number; rates: number[] }>();
      allLoads.forEach(load => {
        if (load.origin && load.destination) {
          const lane = `${load.origin} → ${load.destination}`;
          const existing = laneMap.get(lane) || { count: 0, rates: [] };
          existing.count++;
          if (load.ratePerMile) existing.rates.push(load.ratePerMile);
          laneMap.set(lane, existing);
        }
      });

      const topLanes = Array.from(laneMap.entries())
        .map(([lane, data]) => ({
          lane,
          count: data.count,
          avgRate: data.rates.length > 0
            ? data.rates.reduce((a, b) => a + b, 0) / data.rates.length
            : null
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Calculate relationship score
      const relationshipScore = this.calculateRelationshipScore({
        totalLoads: allLoads.length,
        loadsThisMonth,
        avgRatePerMile: avgRatePerMile || 0,
        laneConsistency: topLanes.length > 0 ? topLanes[0].count / allLoads.length : 0
      });

      // Calculate average days between contacts
      const dates = allLoads.map(l => l.extractedAt.getTime()).sort();
      const avgDaysBetween = dates.length > 1
        ? (dates[dates.length - 1] - dates[0]) / (dates.length - 1) / (24 * 60 * 60 * 1000)
        : null;

      // Upsert broker stats
      const existingStats = await prisma.brokerStats.findUnique({
        where: { broker: brokerName }
      });

      await prisma.brokerStats.upsert({
        where: { broker: brokerName },
        create: {
          broker: brokerName,
          brokerEmail: allLoads[0]?.brokerEmail,
          totalLoads: allLoads.length,
          loadsThisMonth,
          loadsThisWeek,
          avgRatePerMile,
          highestRate,
          lowestRate,
          topLanes: topLanes as any,
          laneCount: laneMap.size,
          firstContactDate: allLoads[0].extractedAt,
          lastContactDate: now,
          avgDaysBetween,
          relationshipScore
        },
        update: {
          brokerEmail: allLoads[0]?.brokerEmail,
          totalLoads: allLoads.length,
          loadsThisMonth,
          loadsThisWeek,
          avgRatePerMile,
          highestRate,
          lowestRate,
          topLanes: topLanes as any,
          laneCount: laneMap.size,
          lastContactDate: now,
          avgDaysBetween,
          relationshipScore
        }
      });

    } catch (error) {
      console.error(`Error updating broker stats for ${brokerName}:`, error);
    }
  }

  /**
   * NEW: Calculate relationship score for broker
   */
  private calculateRelationshipScore(stats: {
    totalLoads: number;
    loadsThisMonth: number;
    avgRatePerMile: number;
    laneConsistency: number;
  }): number {
    let score = 0;

    // Volume (40 points)
    if (stats.totalLoads >= 50) score += 40;
    else if (stats.totalLoads >= 20) score += 30;
    else if (stats.totalLoads >= 10) score += 20;
    else score += stats.totalLoads;

    // Activity (30 points)
    if (stats.loadsThisMonth >= 10) score += 30;
    else if (stats.loadsThisMonth >= 5) score += 20;
    else if (stats.loadsThisMonth >= 2) score += 10;

    // Rate quality (20 points)
    if (stats.avgRatePerMile >= this.prefs.minRatePerMile + 0.5) score += 20;
    else if (stats.avgRatePerMile >= this.prefs.minRatePerMile) score += 15;
    else if (stats.avgRatePerMile >= this.prefs.minRatePerMile - 0.25) score += 10;

    // Consistency (10 points)
    score += stats.laneConsistency * 10;

    return Math.min(score, 100);
  }

  // ============ EXISTING METHODS BELOW (keeping all your current extraction logic) ============

  /**
   * Calculate approximate distance between two states
   */
  private calculateDistance(
    originCity: string,
    originState: string,
    destCity: string,
    destState: string
  ): number | null {
    const stateDistances: { [key: string]: number } = {
      'TX-TX': 300,    'TX-NE': 900,    'TX-AL': 700,    'TX-NM': 400,
      'TX-OK': 250,    'TX-LA': 350,    'TX-AR': 400,    'TX-CO': 800,
      'VA-MO': 880,    'VA-NC': 250,    'VA-GA': 500,    'VA-TN': 450,
      'CA-TX': 1400,   'CA-AZ': 400,    'CA-NV': 450,    'CA-OR': 600,
      'FL-WY': 2000,   'FL-CO': 1900,   'FL-IL': 1200,   'FL-TX': 1300,
      'FL-GA': 350,    'FL-AL': 450,    'FL-SC': 550,    'FL-NC': 650,
      'FL-FL': 300,    'NY-CA': 2700,   'NY-FL': 1200,   'NY-TX': 1700,
      'IL-TX': 1000,   'IL-FL': 1200,   'IL-CA': 2000,   'IL-NY': 800,
      'IA-TX': 900,    'IA-IL': 300,    'IA-NE': 200,    'IA-MN': 250,
      'AZ-FL': 2000,   'AZ-TX': 900,    'AZ-CA': 400,    'AZ-NM': 350,
      'KS-TX': 500,    'KS-CO': 400,    'KS-NE': 200,    'KS-OK': 250,
      'MN-GA': 1200,   'MN-IL': 450,    'MN-TX': 1200,   'MN-FL': 1500,
      'OH-AL': 650,    'OH-GA': 700,    'OH-FL': 1100,   'OH-TX': 1200,
      'WI-IL': 200,    'WI-TX': 1100,   'WI-FL': 1400,   'WI-CA': 1900,
      'GA-TX': 1000,   'GA-FL': 350,    'GA-NC': 350,    'GA-SC': 250,
      'NC-TX': 1300,   'NC-FL': 650,    'NC-VA': 250,    'NC-SC': 200,
      'PA-FL': 1100,   'PA-TX': 1500,   'PA-OH': 350,    'PA-NY': 250,
      'MI-TX': 1200,   'MI-FL': 1300,   'MI-IL': 300,    'MI-OH': 250,
      'TN-TX': 800,    'TN-FL': 650,    'TN-GA': 250,    'TN-NC': 350,
      'MO-TX': 700,    'MO-IL': 300,    'MO-KS': 250,    'MO-AR': 250,
    };

    const routeKey = `${originState}-${destState}`;
    const reverseKey = `${destState}-${originState}`;

    return stateDistances[routeKey] || stateDistances[reverseKey] || null;
  }

  private stripHtml(html: string): string {
    if (!html) return '';
    
    let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
    
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&rsquo;/g, "'");
    
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n');
    text = text.replace(/<\/div>/gi, '\n');
    text = text.replace(/<\/tr>/gi, '\n');
    text = text.replace(/<td[^>]*>/gi, ' | ');
    text = text.replace(/<[^>]+>/g, ' ');
    
    text = text.replace(/\s+/g, ' ');
    text = text.replace(/\n\s+/g, '\n');
    text = text.replace(/\s+\n/g, '\n');
    
    return text.trim();
  }

  private parseHtmlTable(html: string): Array<{ [key: string]: string }> {
    const rows: Array<{ [key: string]: string }> = [];
    
    const tableMatch = html.match(/<table[^>]*>(.*?)<\/table>/is);
    if (!tableMatch) return rows;
    
    const tableContent = tableMatch[1];
    const trMatches = tableContent.match(/<tr[^>]*>(.*?)<\/tr>/gis);
    if (!trMatches) return rows;
    
    let headers: string[] = [];
    
    trMatches.forEach((tr, index) => {
      const cells: string[] = [];
      
      const thMatches = tr.match(/<th[^>]*>(.*?)<\/th>/gis);
      const tdMatches = tr.match(/<td[^>]*>(.*?)<\/td>/gis);
      
      if (thMatches && index === 0) {
        headers = thMatches.map(th => this.stripHtml(th).trim().toLowerCase());
      } else if (tdMatches) {
        const rowData: { [key: string]: string } = {};
        
        tdMatches.forEach((td, cellIndex) => {
          const cellValue = this.stripHtml(td).trim();
          const key = headers[cellIndex] || `col${cellIndex}`;
          rowData[key] = cellValue;
        });
        
        if (Object.keys(rowData).length > 0) {
          rows.push(rowData);
        }
      }
    });
    
    return rows;
  }

  private extractLoadNumber(content: string): string | null {
    const patterns = [
      /load\s*#?\s*[:=]?\s*([A-Z0-9\-]+)/i,
      /ref(?:erence)?[\s:]+#?\s*([A-Z0-9\-]+)/i,
      /order\s*#?\s*[:=]?\s*([A-Z0-9\-]+)/i,
      /#(\d{5,})/,
      /\b([A-Z]{2,4}\d{4,})\b/,
    ];
    
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        const loadNum = match[1].trim();
        if (loadNum.length >= 4 && loadNum.length <= 20) {
          return loadNum;
        }
      }
    }
    return null;
  }

  private extractRate(content: string): number | null {
    const patterns = [
      /rate[\s:]+\$\s*([\d,]+\.?\d*)/i,
      /target\s*rate[\s:]+\$?\s*([\d,]+\.?\d*)/i,
      /pay[\s:]+\$?\s*([\d,]+\.?\d*)/i,
      /all\s*in[\s:]+\$?\s*([\d,]+\.?\d*)/i,
      /^\$\s*([\d,]+\.?\d*)$/m,
      /\$\s*([\d,]+\.?\d*)/,
    ];
    
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        const rateStr = match[1].replace(/,/g, '');
        const rate = parseFloat(rateStr);
        
        if (rate >= 300 && rate <= 15000) {
          return rate;
        }
      }
    }
    return null;
  }

  private normalizeCity(city: string): string {
    if (!city) return '';
    
    city = city.trim();
    
    if (city === city.toUpperCase()) {
      return city
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }
    
    return city;
  }

  private extractLane(content: string): {
    originCity: string;
    originState: string;
    destCity: string;
    destState: string;
  } | null {
    let cleanContent = content;
    cleanContent = cleanContent.replace(/SLEEK FLEET NOTIFICATION[^:]+:/gi, '');
    cleanContent = cleanContent.replace(/A new load was added with pickup in/gi, '');
    cleanContent = cleanContent.replace(/\w+ Logistics Services is offering a load from/gi, '');
    
    const pattern1 = /\b([A-Z][A-Za-z\s\.]{2,25}),?\s*([A-Z]{2})\s*(?:to|→|->|—|–|-->)\s*([A-Z][A-Za-z\s\.]{2,25}),?\s*([A-Z]{2})\b/i;
    const match1 = cleanContent.match(pattern1);
    
    if (match1) {
      const originCity = match1[1].trim();
      const originState = match1[2].toUpperCase();
      const destCity = match1[3].trim();
      const destState = match1[4].toUpperCase();
      
      if (US_STATES.includes(originState) && US_STATES.includes(destState)) {
        return {
          originCity: this.normalizeCity(originCity),
          originState,
          destCity: this.normalizeCity(destCity),
          destState,
        };
      }
    }
    
    const pattern2 = /\b([A-Z]{2})\s*(?:to|→|->|—|–|-->)\s*([A-Z]{2})\b/;
    const match2 = cleanContent.match(pattern2);
    
    if (match2) {
      const originState = match2[1].toUpperCase();
      const destState = match2[2].toUpperCase();
      
      if (US_STATES.includes(originState) && US_STATES.includes(destState)) {
        return {
          originCity: '',
          originState,
          destCity: '',
          destState,
        };
      }
    }
    
    return null;
  }

  private extractMiles(content: string): number | null {
    const patterns = [
      /(\d{2,4})\s*miles?/i,
      /miles?[\s:]+(\d{2,4})/i,
      /distance[\s:]+(\d{2,4})/i,
    ];
    
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        const miles = parseInt(match[1]);
        if (miles >= 50 && miles <= 3500) {
          return miles;
        }
      }
    }
    return null;
  }

  private extractEquipment(content: string): string | null {
    const equipmentTypes = [
      'dry van', 'van', 'reefer', 'flatbed', 'stepdeck', 'step deck',
      'lowboy', 'conestoga', 'hotshot', 'box truck', 'sprinter',
      'power only', 'tanker', 'dump', 'hopper',
    ];
    
    const lowerContent = content.toLowerCase();
    
    for (const type of equipmentTypes) {
      if (lowerContent.includes(type)) {
        return type.split(' ').map(word => 
          word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
      }
    }
    
    return null;
  }

  private extractWeight(content: string): number | null {
    const patterns = [
      /(\d{1,2}[,\s]?\d{3,5})\s*lbs?\.?/i,
      /weight[\s:]+(\d{1,2}[,\s]?\d{3,5})/i,
    ];
    
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        const weightStr = match[1].replace(/[,\s]/g, '');
        const weight = parseInt(weightStr);
        if (weight >= 100 && weight <= 50000) {
          return weight;
        }
      }
    }
    return null;
  }

  private extractDates(content: string): {
    pickupDate?: Date;
    deliveryDate?: Date;
  } {
    const result: { pickupDate?: Date; deliveryDate?: Date } = {};
    const dates: Date[] = [];
    
    const datePatterns = [
      /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/g,
      /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})/gi,
    ];
    
    datePatterns.forEach(pattern => {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        try {
          let date: Date;
          
          if (match[0].includes('/')) {
            const month = parseInt(match[1]) - 1;
            const day = parseInt(match[2]);
            let year = parseInt(match[3]);
            if (year < 100) year += 2000;
            
            date = new Date(year, month, day);
          } else {
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const month = monthNames.findIndex(m => m.toLowerCase() === match[1].toLowerCase());
            const day = parseInt(match[2]);
            const year = parseInt(match[3]);
            
            date = new Date(year, month, day);
          }
          
          if (!isNaN(date.getTime())) {
            dates.push(date);
          }
        } catch (e) {
          // Skip invalid dates
        }
      }
    });
    
    dates.sort((a, b) => a.getTime() - b.getTime());
    
    if (dates.length >= 1) result.pickupDate = dates[0];
    if (dates.length >= 2) result.deliveryDate = dates[1];
    
    return result;
  }

  private extractContact(content: string, fromEmail: string): {
    contactName?: string;
    contactPhone?: string;
    contactEmail?: string;
  } {
    const result: {
      contactName?: string;
      contactPhone?: string;
      contactEmail?: string;
    } = {};
    
    const phonePattern = /(\+?1?\s*\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4}))/;
    const phoneMatch = content.match(phonePattern);
    if (phoneMatch) {
      result.contactPhone = phoneMatch[1].trim();
    }
    
    const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const emailMatches = content.matchAll(emailPattern);
    
    for (const match of emailMatches) {
      const email = match[1].toLowerCase();
      if (email.includes('ops') || email.includes('operations') || email.includes('dispatch')) {
        result.contactEmail = email;
        break;
      } else if (!result.contactEmail) {
        result.contactEmail = email;
      }
    }
    
    if (!result.contactEmail) {
      result.contactEmail = fromEmail;
    }
    
    const namePatterns = [
      /(?:regards|thanks|sincerely),?\s*\n\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/i,
      /([A-Z][a-z]+\s+[A-Z][a-z]+)\s*\n\s*(?:carrier|operations|dispatch)/i,
    ];
    
    for (const pattern of namePatterns) {
      const match = content.match(pattern);
      if (match) {
        result.contactName = match[1].trim();
        break;
      }
    }
    
    return result;
  }

  extractLoad(
    messageId: string,
    subject: string,
    body: string,
    fromEmail: string
  ): LoadData | null {
    try {
      const cleanText = this.stripHtml(body);
      const fullContent = `${subject}\n${cleanText}`;
      
      const tableData = this.parseHtmlTable(body);
      
      const loadNumber = this.extractLoadNumber(fullContent);
      const lane = this.extractLane(fullContent);
      const rate = this.extractRate(fullContent);
      let miles = this.extractMiles(fullContent);
      const equipment = this.extractEquipment(fullContent);
      const weight = this.extractWeight(fullContent);
      const dates = this.extractDates(fullContent);
      const contact = this.extractContact(fullContent, fromEmail);
      
      if (lane && !miles) {
        const calculated = this.calculateDistance(
          lane.originCity,
          lane.originState,
          lane.destCity,
          lane.destState
        );
        if (calculated) {
          miles = calculated;
        }
      }
      
      let ratePerMile: number | undefined;
      if (rate && miles) {
        ratePerMile = Math.round((rate / miles) * 100) / 100;
        if (ratePerMile > 15) {
          console.warn(`Suspicious rate: ${ratePerMile}/mi for $${rate}/${miles}mi - ${subject.substring(0, 40)}`);
          ratePerMile = undefined;
        }
      }
      
      let confidence = 0;
      if (lane) confidence += 30;
      if (rate) confidence += 25;
      if (miles) confidence += 20;
      if (equipment) confidence += 10;
      if (loadNumber) confidence += 5;
      if (weight) confidence += 5;
      if (dates.pickupDate) confidence += 3;
      if (dates.deliveryDate) confidence += 2;
      
      if (confidence < 25) {
        return null;
      }
      
      const loadData: LoadData = {
        confidence,
        loadNumber,
        rate,
        miles,
        ratePerMile,
        equipment,
        weight,
        ...lane,
        ...dates,
        ...contact,
      };
      
      return loadData;
    } catch (error) {
      console.error('Error extracting load:', error);
      return null;
    }
  }

  async extractLoadsFromMessages(
    messages: Array<{
      id: string;
      subject: string;
      body: string;
      from: string;
    }>
  ): Promise<LoadData[]> {
    const loads: LoadData[] = [];
    
    for (const message of messages) {
      const loadData = this.extractLoad(
        message.id,
        message.subject,
        message.body,
        message.from
      );
      
      if (loadData) {
        loads.push(loadData);
      }
    }
    
    return loads;
  }

  isLoadOffer(subject: string, body: string): boolean {
    const content = `${subject} ${body}`.toLowerCase();
    
    const newsletterKeywords = [
      'newsletter',
      'weekly trucking news',
      'market update',
      'industry update',
      'unsubscribe from future',
      'update profile',
    ];
    
    if (newsletterKeywords.some(keyword => content.includes(keyword))) {
      return false;
    }
    
    const loadKeywords = [
      'available load',
      'load offer',
      'pick',
      'del',
      'delivery',
      'destination',
      'origin',
      'rate:',
      'miles',
      'equipment:',
    ];
    
    const hasLoadKeywords = loadKeywords.filter(keyword => 
      content.includes(keyword)
    ).length;
    
    return hasLoadKeywords >= 2;
  }
}

export default LoadExtractorService;