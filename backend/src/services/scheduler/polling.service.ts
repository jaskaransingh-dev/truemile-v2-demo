// src/services/scheduler/polling.service.ts

import cron from 'node-cron';
import { prisma } from '../db';
import { GmailSyncService } from '../gmail/sync.service';
import { OutlookSyncService } from '../outlook/sync.service';
import { DispatchReplyPoller } from '../dispatch/reply-poller.service';

export class PollingScheduler {
  private static cronJob: cron.ScheduledTask | null = null;
  private static isRunning = false;

  /**
   * Start the polling scheduler
   */
  static start(): void {
    if (this.cronJob) {
      console.log('Polling scheduler already running');
      return;
    }

    const intervalMinutes = parseInt(process.env.SYNC_INTERVAL_MINUTES || '5');
    const cronExpression = `*/${intervalMinutes} * * * *`;

    console.log(`Starting polling scheduler - every ${intervalMinutes} minutes`);

    this.cronJob = cron.schedule(cronExpression, async () => {
      await this.runSyncCycle();
    });

    setTimeout(() => this.runSyncCycle(), 5000);
  }

  /**
   * Stop the polling scheduler
   */
  static stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      console.log('Polling scheduler stopped');
    }
  }

  /**
   * Run a sync cycle for all active accounts
   */
  private static async runSyncCycle(): Promise<void> {
    if (this.isRunning) {
      console.log('Sync cycle already in progress, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      console.log('\n=== Starting sync cycle ===');

      const accounts = await prisma.emailAccount.findMany({
        where: { isActive: true }
      });

      console.log(`Found ${accounts.length} active email accounts`);

      const results = {
        total: accounts.length,
        success: 0,
        failed: 0,
        totalMessages: 0
      };

      for (const account of accounts) {
  try {
    console.log(`\nSyncing ${account.provider} account: ${account.email}`);

    let result;
    if (account.provider === 'GMAIL') {
      result = await GmailSyncService.syncMessages(account.id);
    } else if (account.provider === 'OUTLOOK') {
      result = await OutlookSyncService.syncMessages(account.id);
    } else {
      console.warn(`Unknown provider: ${account.provider}`);
      continue;
    }

    console.log(`✓ Synced ${result.messagesSynced}/${result.messagesFound} messages`);
    results.success++;
    results.totalMessages += result.messagesSynced;
    
    // Release connections between accounts
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (error) {
    console.error(`✗ Failed to sync ${account.email}:`, error);
    results.failed++;
  }
}

      await DispatchReplyPoller.pollBrokerReplies();

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`\n=== Sync cycle complete ===`);
      console.log(`Duration: ${duration}s`);
      console.log(`Success: ${results.success}/${results.total}`);
      console.log(`Failed: ${results.failed}/${results.total}`);
      console.log(`Total messages synced: ${results.totalMessages}`);
    } catch (error) {
      console.error('Sync cycle error:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Manually trigger a sync cycle (for testing/debugging)
   */
  static async triggerManualSync(): Promise<void> {
    console.log('Manual sync triggered');
    await this.runSyncCycle();
  }
}

process.on('SIGINT', async () => {
  console.log('\nShutting down polling scheduler...');
  PollingScheduler.stop();
  await prisma.$disconnect();
  process.exit(0);
});