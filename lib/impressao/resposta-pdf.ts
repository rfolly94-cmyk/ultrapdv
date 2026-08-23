import { NextResponse } from "next/server";

export function respostaPdf(
  pdf: Uint8Array,
  filename: string,
  disposicao: "inline" | "attachment" = "inline"
) {
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposicao}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
