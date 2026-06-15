import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { parseImportFile, ParseError } from "@/lib/parsers";
import { PdfPasswordError } from "@/lib/parsers/funds";

const MAX_FILE_BYTES = 8 * 1024 * 1024; // CAS PDFs can run larger than a CSV.

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const password = (formData?.get("password") as string | null) ?? undefined;
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File is larger than 8 MB." }, { status: 413 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await parseImportFile(buffer, file.name, password);
    return NextResponse.json({ ...result, fileName: file.name });
  } catch (err) {
    if (err instanceof PdfPasswordError) {
      // 422 + flag so the UI can prompt for (or re-prompt) the CAS password.
      return NextResponse.json({ error: err.message, needsPassword: true, wrongPassword: err.wrong }, { status: 422 });
    }
    if (err instanceof ParseError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("Import parse failed:", err);
    return NextResponse.json({ error: "Failed to read the file." }, { status: 500 });
  }
}
