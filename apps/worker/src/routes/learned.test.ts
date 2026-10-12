import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppVariables, Env } from "../env";
import learned from "./learned";

function fakeDb() {
  const executed: string[] = [];
  const statement = (sql: string) => ({
    bind: () => ({
      run: async () => {
        executed.push(sql);
        return {};
      },
    }),
    run: async () => {
      executed.push(sql);
      return {};
    },
  });
  return { executed, db: { prepare: (sql: string) => statement(sql) } };
}

function appAs(role: AppVariables["role"]) {
  const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
  app.use("*", async (c, next) => {
    c.set("userId", 1);
    c.set("username", "tester");
    c.set("name", "Tester");
    c.set("role", role);
    c.set("sessionId", "s");
    await next();
  });
  app.route("/learned", learned);
  return app;
}

async function send(role: AppVariables["role"], path: string) {
  const { executed, db } = fakeDb();
  const res = await appAs(role).request(path, { method: "DELETE" }, { DB: db } as unknown as Env);
  return { res, deletes: executed.filter((sql) => sql.startsWith("DELETE")) };
}

describe("learned rule deletion permissions", () => {
  it("refuses a clerk deleting one rule", async () => {
    const { res, deletes } = await send("clerk", "/learned/cotton%20shirt");
    expect(res.status).toBe(403);
    expect(deletes).toEqual([]);
  });

  it("refuses a clerk clearing all rules", async () => {
    const { res, deletes } = await send("clerk", "/learned");
    expect(res.status).toBe(403);
    expect(deletes).toEqual([]);
  });

  it("lets an admin delete one rule", async () => {
    const { res, deletes } = await send("admin", "/learned/cotton%20shirt");
    expect(res.status).toBe(200);
    expect(deletes).toEqual(["DELETE FROM learned WHERE normalized_desc = ?"]);
  });

  it("lets an admin clear all rules", async () => {
    const { res, deletes } = await send("admin", "/learned");
    expect(res.status).toBe(200);
    expect(deletes).toEqual(["DELETE FROM learned"]);
  });
});
