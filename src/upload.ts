/**
 * A dropped file becomes text, and text is what the extractor already reads.
 *
 * So an uploaded spreadsheet takes exactly the same path as pasted text: same
 * prompt, same schema, same server-side checks. There is no second, weaker
 * route into the send path for files.
 */
const isExcel = (name: string) => /\.xlsx?$/i.test(name)

export async function fileToText(file: File): Promise<string> {
  if (!isExcel(file.name)) return file.text()

  // Only the .xlsx path needs a parser; csv/tsv/txt are already text.
  const { default: readXlsxFile } = await import('read-excel-file/browser')
  // It answers with one entry per sheet, not with rows. Only the first sheet
  // is read; a second one would be a different list of people, not more of
  // this one.
  const sheets = (await readXlsxFile(file)) as unknown as { sheet: string; data: unknown[][] }[]
  const rows = sheets[0]?.data ?? []
  const cell = (v: unknown) =>
    v == null
      ? ''
      : // A date cell arrives as a Date. Left as-is it stringifies to
        // "Fri Sep 18 2026 ..." in the local zone, which can read as the day
        // before. ISO is what the extractor is told to expect anyway.
        typeof (v as Date)?.toISOString === 'function'
        ? (v as Date).toISOString().slice(0, 10)
        : String(v)
  return rows.map((r) => r.map(cell).join('\t')).join('\n')
}

export const ACCEPTED = '.xlsx,.xls,.csv,.tsv,.txt'
