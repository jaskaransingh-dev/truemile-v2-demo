import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// PUT /api/drivers/location — receive location ping from driver mobile app
router.put('/location', async (req: Request, res: Response) => {
  const { phone, lat, lon, timestamp } = req.body;

  if (!phone || lat == null || lon == null) {
    return res.status(400).json({ error: 'phone, lat, lon required' });
  }

  try {
    // Reverse geocode to get city name
    let locationName = `${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`;
    try {
      const geoRes = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${process.env.GOOGLE_MAPS_API_KEY}`
      );
      const geoData = await geoRes.json() as any;
      if (geoData.results && geoData.results[0]) {
        const components = geoData.results[0].address_components;
        const city = components.find((c: any) => c.types.includes('locality'))?.long_name;
        const state = components.find((c: any) => c.types.includes('administrative_area_level_1'))?.short_name;
        if (city && state) locationName = `${city}, ${state}`;
      }
    } catch (geoErr) {
      console.warn('[driver-location] geocode failed, using lat/lon:', geoErr);
    }

    // Find driver by phone number
    const driver = await prisma.driver.findFirst({
      where: { phoneNumber: phone },
    });

    if (!driver) {
      console.log('[driver-location] no driver found for submitted phone');
      return res.status(404).json({ error: 'Driver not found' });
    }

    // Upsert DriverOperationalState
    await prisma.driverOperationalState.upsert({
      where: { driverId: driver.id },
      update: {
        currentLat: Number(lat),
        currentLon: Number(lon),
        currentLocation: locationName,
        currentLocationTimestamp: new Date(timestamp || Date.now()),
      },
      create: {
        driverId: driver.id,
        currentLat: Number(lat),
        currentLon: Number(lon),
        currentLocation: locationName,
        currentLocationTimestamp: new Date(timestamp || Date.now()),
      },
    });

    console.log(`[driver-location] ${driver.name} → ${locationName} (${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)})`);
    return res.json({ success: true, location: locationName });
  } catch (err: any) {
    console.error('[driver-location] error:', err.message);
    return res.status(500).json({ error: 'Failed to update location' });
  }
});

export default router;
