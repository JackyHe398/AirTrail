import { Kysely, PostgresDialect } from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveFlightPassengerChanges,
  upsertFlightTrackPrimitiveWithConnection,
} from './queries';
import type { DB } from './schema';
import type { CreateFlightPassenger } from './types';

import { reduceFlightTrackForMap } from '$lib/track/render';
import {
  flightTrackPayloadSchema,
  type FlightTrackInput,
} from '$lib/track/schema';

const passenger = (
  userId: string | null,
  guestName: string | null = null,
): CreateFlightPassenger => ({
  userId,
  guestName,
  seat: null,
  seatNumber: null,
  seatClass: null,
  flightReason: null,
});

describe('resolveFlightPassengerChanges', () => {
  const existing = [
    { id: 1, userId: 'user-one', guestName: null },
    { id: 2, userId: null, guestName: 'Guest' },
  ];

  it('preserves IDs supplied by the flight form', () => {
    const incoming = { ...passenger('user-one'), id: 1 };
    const result = resolveFlightPassengerChanges(existing, [incoming]);

    expect(result.resolved[0]?.existing?.id).toBe(1);
    expect(result.removedIds).toEqual([2]);
  });

  it('preserves IDs for legacy payloads by passenger identity', () => {
    const result = resolveFlightPassengerChanges(existing, [
      passenger(null, 'Guest'),
    ]);

    expect(result.resolved[0]?.existing?.id).toBe(2);
    expect(result.removedIds).toEqual([1]);
  });

  it('rejects IDs from another flight', () => {
    expect(() =>
      resolveFlightPassengerChanges(existing, [
        { ...passenger('user-one'), id: 99 },
      ]),
    ).toThrow('Passenger does not belong to this flight');
  });
});

describe('upsertFlightTrackPrimitiveWithConnection', () => {
  it.each([undefined, false, true])(
    'stores tracks with compressOnImport set to %s',
    async (compressOnImport) => {
      const query = vi
        .fn()
        .mockResolvedValue({ command: 'INSERT', rowCount: 1, rows: [] });
      const db = new Kysely<DB>({
        dialect: new PostgresDialect({
          pool: {
            options: {},
            connect: async () => ({ query, release() {} }),
            end: async () => {},
          },
        }),
      });
      const times = [
        0, 25, 50, 75, 100, 200, 225, 250, 275, 300, 325, 350, 375,
      ];
      const track: FlightTrackInput = {
        coordinates: times.map((_, index) => [index / 1_000, 0, 1_000]),
        times,
        ground: times.map(() => false),
        groundSpeedKt: times.map((_, index) => 200 + index),
        trackDeg: times.map((_, index) => 90 + index),
        estimated: times.map((_, index) => index === 8),
        sourceFormat: 'csv',
        sourceName: 'flight.csv',
        compressOnImport,
      };

      await upsertFlightTrackPrimitiveWithConnection(db, 7, track);
      const [, parameters] = query.mock.lastCall!;
      const payload = flightTrackPayloadSchema.parse(
        JSON.parse(JSON.stringify(parameters[1])),
      );
      const rendered = reduceFlightTrackForMap(payload);
      const retained = [0, 4, 5, 6, 7, 8, 9, 12];
      const gapFlags = [false, false, true, false, false, true, false, false];

      expect(parameters.slice(2, 5)).toEqual([
        'csv',
        'flight.csv',
        compressOnImport ? retained.length : times.length,
      ]);
      expect(parameters[1]).not.toHaveProperty('compressOnImport');
      expect(payload.coordinates).toEqual(
        compressOnImport
          ? retained.map((index) => track.coordinates[index])
          : track.coordinates,
      );
      expect(payload.storageCompression).toEqual(
        compressOnImport ? { originalPointCount: times.length } : undefined,
      );
      expect(payload.estimated).toEqual(
        compressOnImport ? gapFlags : track.estimated,
      );
      expect(rendered.times).toEqual(retained.map((index) => times[index]));
      expect(rendered.estimated).toEqual(gapFlags);
      expect(rendered.groundSpeedKt).toEqual(
        retained.map((index) => track.groundSpeedKt![index]),
      );
      expect(rendered.trackDeg).toEqual(
        retained.map((index) => track.trackDeg![index]),
      );
      expect(rendered.ground).toEqual(retained.map(() => false));
    },
  );
});
