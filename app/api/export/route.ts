import { NextResponse } from "next/server";
import { getExportRows } from "@/lib/data";

function toCsv(rows: string[][]) {
  return "\uFEFF" + rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`)
        .join(","),
    )
    .join("\n");
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const payload = await getExportRows({
    scope: searchParams.get("scope") || "month",
    year: searchParams.get("year") || "",
    month: searchParams.get("month") || "",
  });

  return new NextResponse(toCsv(payload.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${payload.filename}"`,
    },
  });
}
