import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { z } from "zod";
import { ClaimFoundryError } from "../../claimFoundry/claimFoundryErrors.js";

export const CF6_MYSQL_TEST_ENV_PATH = fileURLToPath(
  new URL("../../../.env.cf6-mysql-test", import.meta.url),
);

const mysqlTestEnvironmentSchema = z.object({
  CF6_MYSQL_TEST_HOST: z.string().trim().min(1),
  CF6_MYSQL_TEST_PORT: z.coerce.number().int().min(1).max(65_535),
  CF6_MYSQL_TEST_USER: z.string().trim().min(1),
  CF6_MYSQL_TEST_PASSWORD: z.string().min(1),
  CF6_MYSQL_TEST_DATABASE: z.string().trim()
    .regex(/^[A-Za-z0-9_]+$/)
    .refine(name => /(?:test|tmp|temp|disposable|cf6)/i.test(name), {
      message: "database name must explicitly identify a disposable CF6 test database",
    }),
  CF6_MYSQL_TEST_DISPOSABLE: z.literal("true"),
}).strip();

export type Cf6MySqlTestEnvironment = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

export function readCf6MySqlTestEnvironment(): Cf6MySqlTestEnvironment {
  let values: Record<string, string>;
  try {
    values = parse(readFileSync(CF6_MYSQL_TEST_ENV_PATH));
  } catch (error) {
    throw new ClaimFoundryError(
      "CF6_UNAUTHORIZED_CONTENT",
      `Unable to read the dedicated MySQL test environment file: ${CF6_MYSQL_TEST_ENV_PATH}`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }

  const parsed = mysqlTestEnvironmentSchema.safeParse(values);
  if (!parsed.success) {
    throw new ClaimFoundryError(
      "CF6_UNAUTHORIZED_CONTENT",
      "CF6 MySQL durability tests require a complete, explicitly disposable test configuration",
      { issues: parsed.error.issues },
    );
  }

  return {
    host: parsed.data.CF6_MYSQL_TEST_HOST,
    port: parsed.data.CF6_MYSQL_TEST_PORT,
    user: parsed.data.CF6_MYSQL_TEST_USER,
    password: parsed.data.CF6_MYSQL_TEST_PASSWORD,
    database: parsed.data.CF6_MYSQL_TEST_DATABASE,
  };
}
