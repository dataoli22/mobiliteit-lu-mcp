import { timingSafeEqual } from "node:crypto";

/** Constant-time check of an `Authorization: Bearer <token>` header. */
export function isAuthorized(
  authorization: string | undefined,
  expectedToken: string,
): boolean {
  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }
  const supplied = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(expectedToken);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
