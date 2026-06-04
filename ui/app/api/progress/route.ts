import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Progress = Record<string, unknown> & {
  output_files?: Record<string, string>;
  recent_entities?: unknown[];
};

export async function GET() {
  const root = process.env.ENRICHMENT_ROOT || path.resolve(process.cwd(), "..");
  const currentPath = path.join(root, "data", "investor_company_enrichment", "current-run.json");
  if (!existsSync(currentPath)) {
    return NextResponse.json({ status: "idle", message: "No active enrichment run yet", root, currentPath, recent_entities: [] });
  }
  const current = readJson(currentPath) as Record<string, string>;
  const progressPath = current.progress_path;
  const progress = progressPath && existsSync(progressPath) ? readJson(progressPath) as Progress : { status: "starting", recent_entities: [] };
  const entityCsv = current.entity_csv_path || progress.output_files?.entities_csv || "";
  const sourceCsv = progress.output_files?.sources_csv || "";
  return NextResponse.json({
    ...progress,
    current_run: current,
    files: {
      progress_exists: progressPath ? existsSync(progressPath) : false,
      entities_csv_size: fileSize(entityCsv),
      sources_csv_size: fileSize(sourceCsv),
    },
    generated_at: new Date().toISOString(),
  });
}

function readJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function fileSize(filePath: string) {
  try {
    return filePath && existsSync(filePath) ? statSync(filePath).size : 0;
  } catch {
    return 0;
  }
}
