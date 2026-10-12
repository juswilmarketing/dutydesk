/** Short descriptions shown when hovering navigation tabs. */
export const NAV_TAB_TIPS: Record<string, string> = {
  "/dashboard": "Overview of pending classification, worksheets ready for FlowBoard, and failed exports.",
  "/upload": "Upload supplier invoices (PDF or image). AI extracts line items and matches T&T tariff codes.",
  "/classification": "Verify extracted line items, tariff codes, and confidence before calculating duties.",
  "/manual": "Add items manually by searching the tariff database or using AI classification.",
  "/duties-taxes": "Calculate customs duty, VAT, CIF, and fees — with or without a loaded invoice.",
  "/brokerage": "Brokerage fees, FlowBoard delivery and ASYCUDA export.",
  "/worksheet": "Review the customs worksheet summary and send to FlowBoard for customer delivery.",
  "/learned": "Tariff codes the team has confirmed, reused automatically on similar items.",
  "/reports": "History of worksheets and tax advice, synced across the team.",
  "/users": "Manage clerk accounts and roles (admin).",
  "/admin/integrations": "FlowBoard webhook and integration settings (admin).",
};
