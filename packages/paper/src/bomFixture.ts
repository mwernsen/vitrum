import type { BomReport } from '@vitrum/core'

/**
 * A representative {@link BomReport} for the F-042 paper tests: two glasses (one priced with sheet
 * sizes), an unassigned bucket, two came profiles and a reinforcement bar. Overridable per test.
 */
export function sampleBomReport(over: Partial<BomReport> = {}): BomReport {
  return {
    technique: 'lead',
    cutting: [
      {
        glassId: 'g1',
        code: 'A',
        name: 'Ruby, red',
        color: '#c0392b',
        manufacturer: 'Aurora',
        rows: [
          {
            contentId: 'kA1',
            pieceId: 'pA1',
            label: 'A1',
            widthMm: 98.1,
            heightMm: 98.1,
            areaMm2: 9623.61,
            degenerate: false,
          },
          {
            contentId: 'kA2',
            pieceId: 'pA2',
            label: 'A2',
            widthMm: 60,
            heightMm: 40,
            areaMm2: 2400,
            degenerate: false,
          },
        ],
        count: 2,
        netAreaMm2: 12023.61,
        buyAreaMm2: 15630.693,
        pieceIds: ['pA1', 'pA2'],
      },
      {
        glassId: null,
        code: '?',
        name: 'Unassigned',
        rows: [
          {
            contentId: 'kU1',
            pieceId: 'pU1',
            label: '',
            widthMm: 20,
            heightMm: 20,
            areaMm2: 400,
            degenerate: false,
          },
        ],
        count: 1,
        netAreaMm2: 400,
        buyAreaMm2: 520,
        pieceIds: ['pU1'],
      },
    ],
    glass: [
      {
        glassId: 'g1',
        code: 'A',
        name: 'Ruby, red',
        color: '#c0392b',
        manufacturer: 'Aurora',
        count: 2,
        netAreaMm2: 12023.61,
        buyAreaMm2: 15630.693,
        sheet: { widthMm: 600, heightMm: 600, label: 'full', sheetsNeeded: 1 },
        cost: 1.5631,
        pieceIds: ['pA1', 'pA2'],
      },
      {
        glassId: null,
        code: '?',
        name: 'Unassigned',
        count: 1,
        netAreaMm2: 400,
        buyAreaMm2: 520,
        pieceIds: ['pU1'],
      },
    ],
    came: [
      {
        profileId: 'p5',
        name: 'H 5 mm',
        kind: 'H',
        flangeMm: 5,
        heartMm: 1.5,
        netLengthMm: 700,
        buyLengthMm: 770,
        segmentIds: ['s1', 's2'],
      },
      {
        profileId: 'p9',
        name: 'H 9 mm border',
        kind: 'H',
        flangeMm: 9,
        heartMm: 2,
        netLengthMm: 600,
        buyLengthMm: 660,
        segmentIds: ['s3'],
      },
    ],
    foil: null,
    reinforcement: [{ material: 'zinc', count: 1, totalLengthMm: 200, barIds: ['r1'] }],
    weight: { grams: 1420, glassGrams: 1200, leadGrams: 220 },
    factors: { glassWaste: 0.3, leadWaste: 0.1, solderGramsPerMetre: 20, foilRollLengthMm: 33_000 },
    pieceCount: 3,
    ...over,
  }
}

/** The same panel in copper foil, for foil-path coverage. */
export function sampleFoilReport(): BomReport {
  return sampleBomReport({
    technique: 'foil',
    came: [],
    foil: {
      netSeamLengthMm: 1300,
      buySeamLengthMm: 1430,
      rollLengthMm: 33_000,
      rollsNeeded: 1,
      solderGramsPerMetre: 20,
      solderGrams: 26,
      segmentIds: ['s1', 's2', 's3'],
    },
    weight: { grams: 1300, glassGrams: 1200, leadGrams: 100 },
  })
}
