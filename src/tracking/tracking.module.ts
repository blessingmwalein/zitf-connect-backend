import { Module } from '@nestjs/common';
import { TrackingService } from './tracking.service.js';
import { HeatmapService } from './heatmap.service.js';
import { TrackingGateway } from './tracking.gateway.js';
import { TrackingController } from './tracking.controller.js';

@Module({
  controllers: [TrackingController],
  providers: [TrackingService, HeatmapService, TrackingGateway],
  exports: [TrackingService, HeatmapService],
})
export class TrackingModule {}
