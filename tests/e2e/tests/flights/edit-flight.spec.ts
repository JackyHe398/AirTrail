import { airportsFactory } from '@test/factories/airports';
import { flightsFactory } from '@test/factories/flights';
import { usersFactory } from '@test/factories/users';
import { login } from '@test/helpers/auth';
import { db, expect, test } from '@test/index';

test.describe('Edit Flight', () => {
  test('keeps edit focus and supports opt-in track replacement', async ({
    page,
  }) => {
    const { user } = await usersFactory.create();
    await login(page, user);

    const { airport: fromAirport } = await airportsFactory.getOrCreate({
      icao: 'EKCH',
      name: 'Copenhagen Airport',
      municipality: 'Copenhagen',
      lat: 55.618,
      lon: 12.656,
      country: 'DK',
      continent: 'EU',
      tz: 'Europe/Copenhagen',
      type: 'large_airport',
      iata: 'CPH',
    });
    const { airport: toAirport } = await airportsFactory.getOrCreate({
      icao: 'ESSA',
      name: 'Stockholm Arlanda Airport',
      municipality: 'Stockholm',
      lat: 59.652,
      lon: 17.919,
      country: 'SE',
      continent: 'EU',
      tz: 'Europe/Stockholm',
      type: 'large_airport',
      iata: 'ARN',
    });

    const flights = [];
    for (let day = 1; day <= 20; day += 1) {
      flights.push(
        await flightsFactory.create({
          userId: user.id,
          date: `2025-01-${String(day).padStart(2, '0')}`,
          fromId: fromAirport.id,
          toId: toAirport.id,
          departure: `2025-01-${String(day).padStart(2, '0')}T10:00:00.000Z`,
          arrival: `2025-01-${String(day).padStart(2, '0')}T11:15:00.000Z`,
          duration: 4500,
          flightNumber: `AT${String(day).padStart(3, '0')}`,
        }),
      );
    }
    const flightId = flights[0]!.flight.id;
    const originalTrack = await db
      .insertInto('flightTrack')
      .values({
        flightId,
        track: {
          coordinates: [
            [12, 55],
            [13, 56],
            [14, 57],
          ],
        },
        sourceFormat: 'csv',
        sourceName: 'original.csv',
        pointCount: 3,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await page.goto('/');
    await page.getByTestId('list-flights-button').click();

    const listModal = page
      .getByRole('dialog')
      .filter({ hasText: 'All Flights' });
    await expect(listModal).toBeVisible();
    await expect
      .poll(() =>
        listModal.evaluate(
          (element) => element.scrollHeight > element.clientHeight,
        ),
      )
      .toBe(true);

    const targetRow = listModal.locator(`#flight-list-row-${flightId}`);
    await targetRow.scrollIntoViewIfNeeded();
    const editButton = targetRow.getByRole('button', {
      name: 'Edit flight',
    });
    await expect(editButton).toBeVisible();
    await expect
      .poll(() => listModal.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);

    await editButton.click();
    const editModal = page
      .getByRole('dialog')
      .filter({ hasText: 'Edit flight' });
    await expect(editModal).toBeVisible();
    const scrollBeforeSave = await listModal.evaluate(
      (element) => element.scrollTop,
    );

    await editModal
      .getByRole('textbox', { name: 'Flight Number' })
      .fill('AT693');
    await editModal.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Flight updated successfully')).toBeVisible();
    await expect(editModal).not.toBeVisible();
    await expect(targetRow.getByText('AT693')).toBeVisible();
    await expect(editButton).toBeFocused();
    expect(
      await db
        .selectFrom('flightTrack')
        .selectAll()
        .where('flightId', '=', flightId)
        .executeTakeFirstOrThrow(),
    ).toEqual(originalTrack);

    const scrollAfterSave = await listModal.evaluate(
      (element) => element.scrollTop,
    );
    expect(scrollAfterSave).toBe(scrollBeforeSave);

    await editButton.click();
    await expect(editModal).toBeVisible();
    await expect(
      editModal.getByRole('textbox', { name: 'Flight Number' }),
    ).toHaveValue('AT693');

    const trackButton = editModal.getByRole('button', { name: 'Flight track' });
    await trackButton.click();
    const trackModal = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: 'Flight Track', exact: true }),
    });
    const compression = trackModal.getByRole('checkbox', {
      name: 'Compress track when importing',
    });
    await expect(trackModal.getByText('original.csv')).toBeVisible();
    await expect(compression).toBeDisabled();
    await trackModal.locator('input[type="file"]').setInputFiles({
      name: 'replacement.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('latitude,longitude\n0,10\n0,11\n0,12\n0,13\n0,14'),
    });
    await expect(compression).toBeEnabled();
    await expect(compression).not.toBeChecked();
    await compression.click();
    await expect(compression).toBeChecked();
    await trackModal.getByRole('button', { name: 'Done' }).click();

    await trackButton.click();
    await compression.click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(trackModal).not.toBeVisible();
    await trackButton.click();
    await expect(compression).toBeChecked();
    await trackModal.getByRole('button', { name: 'Done' }).click();

    await editModal.getByRole('button', { name: 'Save' }).click();
    await expect(editModal).not.toBeVisible();
    expect(
      await db
        .selectFrom('flightTrack')
        .selectAll()
        .where('flightId', '=', flightId)
        .executeTakeFirstOrThrow(),
    ).toMatchObject({
      sourceName: 'replacement.csv',
      pointCount: 2,
      track: { storageCompression: { originalPointCount: 5 } },
    });
  });
});
