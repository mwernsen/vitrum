import { describe, expect, it } from 'vitest'

import { sampleBomReport, sampleFoilReport } from './bomFixture'
import { bomToCsv } from './bomCsv'

/** F-042 FR-3: CSV imports cleanly — proper quoting, units in headers, plain-number values. */

function lines(csv: string): string[] {
  return csv.split('\r\n')
}

describe('bomToCsv', () => {
  it('names units in the column headers (mm mode)', () => {
    const csv = bomToCsv(sampleBomReport(), 'mm')
    expect(csv).toContain('Width (mm)')
    expect(csv).toContain('Height (mm)')
    expect(csv).toContain('Area (cm2)')
    expect(csv).toContain('Net area (cm2)')
  })

  it('names inch units in inch mode', () => {
    const csv = bomToCsv(sampleBomReport(), 'in')
    expect(csv).toContain('Width (in)')
    expect(csv).toContain('Area (in2)')
    expect(csv).not.toContain('(mm)')
  })

  it('quotes fields containing a comma and doubles embedded quotes (RFC 4180)', () => {
    const report = sampleBomReport()
    const withComma = {
      ...report,
      cutting: [
        {
          ...report.cutting[0]!,
          name: 'Ruby, "deep" red',
        },
      ],
      glass: report.glass,
    }
    const csv = bomToCsv(withComma, 'mm')
    expect(csv).toContain('"Ruby, ""deep"" red"')
  })

  it('emits plain decimal numbers (no unit suffix inside a value)', () => {
    const csv = bomToCsv(sampleBomReport(), 'mm')
    // The Ruby name has a comma, so the row is quoted; find it by its A1 label cell.
    const dataRow = lines(csv).find((l) => l.includes(',A1,'))!
    // Width value is a bare number (98.10), not "98.1 mm".
    expect(dataRow).toMatch(/,98\.10,/)
    expect(dataRow).not.toMatch(/mm/)
  })

  it('labels the cutting-list and BOM blocks and separates them with a blank line', () => {
    const l = lines(bomToCsv(sampleBomReport(), 'mm'))
    expect(l[0]).toBe('Cutting list')
    expect(l).toContain('Glass')
    expect(l).toContain('Lead came')
    expect(l).toContain('Panel weight')
    expect(l).toContain('') // blank separators
  })

  it('emits a copper-foil block (with solder) in foil technique', () => {
    const csv = bomToCsv(sampleFoilReport(), 'mm')
    expect(csv).toContain('Copper foil')
    expect(csv).toContain('Solder (g)')
    expect(csv).not.toContain('Lead came')
  })

  it('ends with a trailing newline', () => {
    expect(bomToCsv(sampleBomReport(), 'mm').endsWith('\r\n')).toBe(true)
  })
})
