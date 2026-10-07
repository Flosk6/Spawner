import { Body, Controller, Delete, Get, HttpCode, Module, Param, Post, Query } from "@nestjs/common";
import type { Actor } from "../../common/actor";
import { CurrentActor } from "../../common/auth.guard";
import { TokensService, type TokenRequest } from "./tokens.service";

/**
 * Personal API tokens, for the CLI, the MCP server and scripts.
 */
@Controller("v1/tokens")
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query("all") all?: string) {
    return this.tokens.list(actor, all === "true");
  }

  /**
   * Answers the token once; only its hint is shown afterwards.
   */
  @Post()
  create(@CurrentActor() actor: Actor, @Body() body: TokenRequest) {
    return this.tokens.create(actor, body ?? {});
  }

  @Delete(":id")
  @HttpCode(204)
  revoke(@CurrentActor() actor: Actor, @Param("id") id: string) {
    return this.tokens.revoke(actor, id);
  }
}

@Module({
  controllers: [TokensController],
  providers: [TokensService],
  exports: [TokensService],
})
export class TokensModule {}
