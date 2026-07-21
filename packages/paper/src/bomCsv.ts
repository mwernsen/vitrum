import { convertLength, type BomReport, type LengthUnit } from '@vitrum/core'

/**
 * Serialize a {@link BomReport} to CSV (F-042 FR-3): imports cleanly into a spreadsheet — every field
 * is RFC-4180 quoted when it contains a comma, quote or newline, units are named in the column
 * headers, and numbers are plain decimals (no unit suffix inside a value) so a spreadsheet reads them
 * as numbers. One file carries both the cutting list and the BOM as labelled blocks separated by a
 * blank line, which spreadsheets tolerate.
 */

/** Length column suffix for headers: `mm` or `in`. */
function lengthUnitLabel(unit: LengthUnit): string {
  return unit
}

/** Small-area column suffix for headers: `cm2` or `in2` (ASCII, spreadsheet-safe). */
function areaUnitLabel(unit: LengthUnit): string {
  return unit === 'in' ? 'in2' : 'cm2'
}

const MM2_PER_CM2 = 100
const MM2_PER_IN2 = 25.4 * 25.4

/** Area (mm²) in the header's small unit, as a plain number. */
function areaValue(mm2: number, unit: LengthUnit): number {
  return unit === 'in' ? mm2 / MM2_PER_IN2 : mm2 / MM2_PER_CM2
}

/** Length (mm) in the display unit, as a plain number. */
function lengthValue(mm: number, unit: LengthUnit): number {
  return convertLength(mm, unit)
}

function num(n: number, digits = 2): string {
  return n.toFixed(digits)
}

/** Quote a CSV field per RFC 4180 when it contains a comma, double-quote or newline. */
function csvField(value: string | number): string {
  const s = String(value)
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function row(...cells: (string | number)[]): string {
  return cells.map(csvField).join(',')
}

export function bomToCsv(report: BomReport, unit: LengthUnit): string {
  const L = lengthUnitLabel(unit)
  const A = areaUnitLabel(unit)
  const lines: string[] = []

  // --- Cutting list ---
  lines.push('Cutting list')
  lines.push(row('Glass code', 'Glass', 'Number', `Width (${L})`, `Height (${L})`, `Area (${A})`))
  for (const group of report.cutting) {
    for (const r of group.rows) {
      lines.push(
        row(
          group.code,
          group.name,
          r.label,
          num(lengthValue(r.widthMm, unit)),
          num(lengthValue(r.heightMm, unit)),
          num(areaValue(r.areaMm2, unit)),
        ),
      )
    }
  }

  lines.push('')

  // --- Glass BOM ---
  lines.push('Glass')
  lines.push(
    row(
      'Code',
      'Glass',
      'Manufacturer',
      'Pieces',
      `Net area (${A})`,
      `Buy area (${A})`,
      'Sheets',
      'Cost',
    ),
  )
  for (const item of report.glass) {
    lines.push(
      row(
        item.code,
        item.name,
        item.manufacturer ?? '',
        item.count,
        num(areaValue(item.netAreaMm2, unit)),
        num(areaValue(item.buyAreaMm2, unit)),
        item.sheet ? item.sheet.sheetsNeeded : '',
        item.cost !== undefined ? num(item.cost) : '',
      ),
    )
  }

  lines.push('')

  // --- Came or foil ---
  if (report.technique === 'lead') {
    lines.push('Lead came')
    lines.push(
      row(
        'Profile',
        'Kind',
        `Flange (${L})`,
        `Heart (${L})`,
        `Net length (${L})`,
        `Buy length (${L})`,
      ),
    )
    for (const came of report.came) {
      lines.push(
        row(
          came.name,
          came.kind,
          num(lengthValue(came.flangeMm, unit)),
          num(lengthValue(came.heartMm, unit)),
          num(lengthValue(came.netLengthMm, unit)),
          num(lengthValue(came.buyLengthMm, unit)),
        ),
      )
    }
  } else if (report.foil) {
    lines.push('Copper foil')
    lines.push(
      row(
        `Net seam (${L})`,
        `Buy seam (${L})`,
        `Roll length (${L})`,
        'Rolls',
        'Solder (g)',
        'Solder (g/m)',
      ),
    )
    const f = report.foil
    lines.push(
      row(
        num(lengthValue(f.netSeamLengthMm, unit)),
        num(lengthValue(f.buySeamLengthMm, unit)),
        num(lengthValue(f.rollLengthMm, unit)),
        f.rollsNeeded,
        num(f.solderGrams),
        f.solderGramsPerMetre,
      ),
    )
  }

  lines.push('')

  // --- Reinforcement ---
  if (report.reinforcement.length > 0) {
    lines.push('Reinforcement')
    lines.push(row('Material', 'Count', `Total length (${L})`))
    for (const bar of report.reinforcement) {
      lines.push(row(bar.material, bar.count, num(lengthValue(bar.totalLengthMm, unit))))
    }
    lines.push('')
  }

  // --- Weight ---
  lines.push('Panel weight')
  lines.push(row('Component', 'Weight (g)'))
  lines.push(row('Total', num(report.weight.grams, 0)))
  lines.push(row('Glass', num(report.weight.glassGrams, 0)))
  lines.push(
    row(report.technique === 'foil' ? 'Foil + solder' : 'Lead', num(report.weight.leadGrams, 0)),
  )

  return lines.join('\r\n') + '\r\n'
}
