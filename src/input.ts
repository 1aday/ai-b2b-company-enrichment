export const REQUIRED_COMPANY_COLUMNS = ["source_record_id", "company_name", "domain", "website_url"] as const;

export function validateCompanySourceRows(rows: Record<string, string>[]) {
  if (!rows.length) throw new Error("Input CSV contains no company rows.");
  const errors: string[] = [];
  for (const [index, row] of rows.entries()) {
    for (const column of REQUIRED_COMPANY_COLUMNS) {
      if (!String(row[column] ?? "").trim()) errors.push(`row ${index + 2}: ${column} is required`);
    }
  }
  if (errors.length) throw new Error(`Invalid company CSV:\n${errors.slice(0, 20).join("\n")}${errors.length > 20 ? `\n...and ${errors.length - 20} more` : ""}`);
}

export function additionalSourceContext(row: Record<string, string>) {
  const required = new Set<string>(REQUIRED_COMPANY_COLUMNS);
  return Object.fromEntries(Object.entries(row).filter(([key]) => !required.has(key)));
}
