/** Outbound email identity for PAS Trinidad (DutyDesk). */
export const COMPANY_NAME = "PAS Trinidad Brokerage Department";
export const COMPANY_SHORT = "PAS Trinidad";
export const COMPANY_EMAIL = "brokerage@pastrinidad.com";
export const COMPANY_TAGLINE = "Customs Brokerage Services · T&T Customs Act Chap. 78:01";

export function buildEmailSignature(senderName: string): string {
  const name = senderName.trim() || "Brokerage Team";
  return `\n\nKind regards,\n${name}\n${COMPANY_NAME}`;
}
