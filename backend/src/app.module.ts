import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TournamentGateway } from './tournament.gateway';
import { TournamentService } from './tournament.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [
    AppService,
    TournamentService,
    TournamentGateway,
  ],
})
export class AppModule {}