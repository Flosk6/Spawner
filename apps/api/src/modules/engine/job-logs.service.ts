import { Injectable } from "@nestjs/common";
import { EventEmitter } from "events";
import * as fs from "fs";
import { Observable } from "rxjs";
import { StorageService } from "./storage.service";

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const FINISHED_CHECK_MS = 5000;

/**
 * Job logs: one file per job, plus live delivery to whoever follows the job.
 */
@Injectable()
export class JobLogsService {
  private readonly events = new EventEmitter();
  private readonly sizes = new Map<string, number>();

  constructor(private readonly storage: StorageService) {
    this.events.setMaxListeners(0);
  }

  /**
   * Appends a timestamped line. Past 5 MiB the job log stops growing.
   */
  append(jobId: string, line: string): void {
    const size = this.sizes.get(jobId) ?? this.fileSize(jobId);
    if (size >= MAX_LOG_BYTES) {
      return;
    }
    const text = size + line.length > MAX_LOG_BYTES ? "[log truncated at 5 MiB]\n" : `${new Date().toISOString()} ${line}\n`;
    fs.appendFileSync(this.storage.jobLogPath(jobId), text);
    this.sizes.set(jobId, size + Buffer.byteLength(text));
    this.events.emit(jobId, text);
  }

  /**
   * Signals followers that the job is over.
   */
  close(jobId: string): void {
    this.sizes.delete(jobId);
    this.events.emit(`${jobId}:end`);
  }

  /**
   * Deletes the log of a job.
   */
  remove(jobId: string): void {
    this.sizes.delete(jobId);
    fs.rmSync(this.storage.jobLogPath(jobId), { force: true });
  }

  read(jobId: string): string {
    try {
      return fs.readFileSync(this.storage.jobLogPath(jobId), "utf8");
    } catch {
      return "";
    }
  }

  /**
   * Emits the log written so far, then each new line, until the job ends.
   *
   * @param jobId - Job to follow
   * @param isFinished - Tells whether the job is over. Checked on subscription
   *   and every few seconds, so a follower never outlives its job, even when
   *   the end was signaled before it subscribed.
   */
  follow(jobId: string, isFinished: () => Promise<boolean>): Observable<string> {
    return new Observable<string>((subscriber) => {
      const send = (text: string) =>
        text
          .split("\n")
          .filter((line) => line.length > 0)
          .forEach((line) => subscriber.next(line));
      const end = () => subscriber.complete();
      const check = () => isFinished().then((finished) => finished && end(), () => undefined);

      // Reading the file and listening happen in the same tick: no line falls in between.
      send(this.read(jobId));
      this.events.on(jobId, send);
      this.events.once(`${jobId}:end`, end);
      check();
      const timer = setInterval(check, FINISHED_CHECK_MS);

      return () => {
        clearInterval(timer);
        this.events.off(jobId, send);
        this.events.off(`${jobId}:end`, end);
      };
    });
  }

  private fileSize(jobId: string): number {
    try {
      return fs.statSync(this.storage.jobLogPath(jobId)).size;
    } catch {
      return 0;
    }
  }
}
