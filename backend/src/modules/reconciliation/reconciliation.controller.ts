import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AppException } from '../../common/app-exception';
import { RequestId } from '../../common/request-context';
import type { Actor } from '../access/actor';
import { CurrentActor, RequirePermission } from '../access/decorators';
import { Permission } from '../access/permissions';
import { MAX_IMPORT_BYTES } from './csv-import';
import { DatasetsService } from './datasets.service';
import { CreateRunBody, ImportDatasetBody, ListDatasetsQuery, ListResultsQuery, ListRunsQuery } from './dto';
import { RunsService } from './runs.service';

@Controller()
export class ReconciliationController {
  constructor(
    private readonly datasets: DatasetsService,
    private readonly runs: RunsService,
  ) {}

  /** multipart/form-data: file (CSV) + unitId + accountId + side. 201 baru, 200 bila file identik sudah ada. */
  @Post('datasets/import')
  @RequirePermission(Permission.DatasetImport)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 10 } }))
  async importDataset(
    @CurrentActor() actor: Actor,
    @Body() body: ImportDatasetBody,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Res({ passthrough: true }) res: Response,
    @RequestId() requestId?: string,
  ) {
    if (!file) throw new AppException(HttpStatus.BAD_REQUEST, 'FILE_REQUIRED', 'Lampirkan file CSV pada field "file"');
    if (!/\.csv$/i.test(file.originalname)) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'UNSUPPORTED_FILE_TYPE', 'Hanya file .csv yang didukung');
    }
    const result = await this.datasets.import(actor, body, file, requestId);
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result;
  }

  @Get('datasets')
  @RequirePermission(Permission.ReconciliationRead)
  listDatasets(@CurrentActor() actor: Actor, @Query() q: ListDatasetsQuery) {
    return this.datasets.list(actor, q);
  }

  /** 201 run baru; 200 bila run dengan pasangan dataset + versi aturan yang sama sudah ada. */
  @Post('reconciliation-runs')
  @RequirePermission(Permission.ReconciliationRun)
  async createRun(
    @CurrentActor() actor: Actor,
    @Body() body: CreateRunBody,
    @Res({ passthrough: true }) res: Response,
    @RequestId() requestId?: string,
  ) {
    const result = await this.runs.create(actor, body, requestId);
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result;
  }

  @Get('reconciliation-runs')
  @RequirePermission(Permission.ReconciliationSummaryRead)
  listRuns(@CurrentActor() actor: Actor, @Query() q: ListRunsQuery) {
    return this.runs.list(actor, q);
  }

  @Get('reconciliation-runs/:id')
  @RequirePermission(Permission.ReconciliationSummaryRead)
  runDetail(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.detail(actor, id);
  }

  @Get('reconciliation-runs/:id/results')
  @RequirePermission(Permission.ReconciliationRead)
  results(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Query() q: ListResultsQuery) {
    return this.runs.results(actor, id, q);
  }

  @Get('reconciliation-runs/:id/summary')
  @RequirePermission(Permission.ReconciliationSummaryRead)
  summary(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.summary(actor, id);
  }
}
