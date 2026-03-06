// src/routes/profit-engine.routes.ts

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { Pool } from 'pg';
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import OpenAI from 'openai';
import * as XLSX from 'xlsx';
import { categorizeExpense } from '../services/categorization-rules';

const execAsync = promisify(exec);
const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Test route - DELETE THIS AFTER TESTING
router.get('/test', (req: Request, res: Response) => {
  console.log('✅ TEST ROUTE HIT');
  res.json({ message: 'Profit engine routes are working!' });
});

router.delete('/test-delete/:id', (req: Request, res: Response) => {
  console.log('✅ TEST DELETE ROUTE HIT, ID:', req.params.id);
  res.json({ success: true, message: 'Delete route works', id: req.params.id });
});

// ============================================================================
// FILE UPLOAD CONFIGURATION
// ============================================================================

// Rate confirmations (PDF only)
const uploadRatecons = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['application/pdf', 'application/octet-stream'].includes(file.mimetype);
    ok ? cb(null, true) : cb(new Error('Only PDF files allowed'));
  }
});

// Fuel/CC/Bank (multiple formats)
const uploadMulti = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream'
    ];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(pdf|csv|xlsx?)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Helper: Find driver by name or alias
async function findDriverByNameOrAlias(name: string): Promise<{ id: number; name: string; isAlias: boolean } | null> {
  // Check driver name first
  const driverResult = await pool.query(
    'SELECT id, name FROM drivers WHERE LOWER(name) = LOWER($1)',
    [name]
  );
  
  if (driverResult.rows.length > 0) {
    return { ...driverResult.rows[0], isAlias: false };
  }

  // Check aliases
  const aliasResult = await pool.query(
    'SELECT d.id, d.name FROM driver_aliases da JOIN drivers d ON da.driver_id = d.id WHERE LOWER(da.alias_name) = LOWER($1)',
    [name]
  );

  if (aliasResult.rows.length > 0) {
    console.log(`🎯 Found driver via alias: "${name}" → ${aliasResult.rows[0].name}`);
    return { ...aliasResult.rows[0], isAlias: true };
  }

  return null;
}

// OCR using OpenAI Vision for image-based PDFs
// OCR using OpenAI Vision for image-based PDFs
// OCR using OpenAI Vision for image-based PDFs
async function extractPdfWithOCR(buffer: Buffer): Promise<string> {
  const tempDir = os.tmpdir();
  const pdfPath = path.join(tempDir, `temp-${Date.now()}.pdf`);
  const imagePrefix = path.join(tempDir, `page-${Date.now()}`);
  
  try {
    // Save PDF temporarily
    await fs.writeFile(pdfPath, buffer);
    
    // Convert ALL PDF pages to PNG images
    console.log('🖼️ Converting all PDF pages to images...');
    await execAsync(`pdftoppm -png "${pdfPath}" "${imagePrefix}"`);
    
    // Find all generated PNG files
    const files = await fs.readdir(tempDir);
    const pngFiles = files
      .filter(f => f.startsWith(path.basename(imagePrefix)) && f.endsWith('.png'))
      .sort()
      .map(f => path.join(tempDir, f));
    
    console.log(`📄 Found ${pngFiles.length} pages to process`);
    
    let allText = '';
    
    // Process each page with OCR
    for (let i = 0; i < pngFiles.length; i++) {
      const pngPath = pngFiles[i];
      console.log(`🤖 OCR processing page ${i + 1}/${pngFiles.length}...`);
      
      const imageBuffer = await fs.readFile(pngPath);
      const base64Image = imageBuffer.toString('base64');
      
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract ALL text from this page. Include ALL numbers, addresses, dates, and payment amounts. Preserve the layout.'
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64Image}`
              }
            }
          ]
        }],
        max_tokens: 4096
      });
      
      const pageText = response.choices[0].message.content || '';
      allText += `\n\n=== PAGE ${i + 1} ===\n\n${pageText}`;
      
      // Cleanup page image
      await fs.unlink(pngPath).catch(() => {});
    }
    
    console.log(`✅ OCR extracted ${allText.length} characters from ${pngFiles.length} pages`);
    
    // Cleanup PDF
    await fs.unlink(pdfPath).catch(() => {});
    
    return allText;
    
  } catch (error: any) {
    console.error('❌ OCR failed:', error.message);
    
    // Cleanup on error
    await fs.unlink(pdfPath).catch(() => {});
    const files = await fs.readdir(tempDir).catch(() => []);
    for (const file of files) {
      if (file.startsWith(path.basename(imagePrefix)) && file.endsWith('.png')) {
        await fs.unlink(path.join(tempDir, file)).catch(() => {});
      }
    }
    
    throw new Error('Failed to extract text from scanned PDF');
  }
}

// Extract text using poppler's pdftotext
async function extractPdfText(buffer: Buffer): Promise<string> {
  const tempDir = os.tmpdir();
  const pdfPath = path.join(tempDir, `temp-${Date.now()}.pdf`);
  const txtPath = pdfPath.replace('.pdf', '.txt');

  try {
    await fs.writeFile(pdfPath, buffer);
    console.log('🔍 Running pdftotext...');
    await execAsync(`pdftotext -layout "${pdfPath}" "${txtPath}"`);
    const text = await fs.readFile(txtPath, 'utf-8');
    await fs.unlink(pdfPath).catch(() => {});
    await fs.unlink(txtPath).catch(() => {});
    
    // If text extraction failed (image-based PDF), use OCR
    if (text.trim().length < 100) {
      console.log('⚠️ Text extraction failed, trying OCR with AI vision...');
      await fs.unlink(pdfPath).catch(() => {});
      return await extractPdfWithOCR(buffer);
    }
    
    return text;
  } catch (error: any) {
    await fs.unlink(pdfPath).catch(() => {});
    await fs.unlink(txtPath).catch(() => {});
    if (error.message?.includes('pdftotext')) {
      throw new Error('pdftotext not installed. Run: brew install poppler');
    }
    throw error;
  }
}

// AI-Powered Rate Confirmation Parser
async function parseRateConfirmation(text: string) {
  console.log('🤖 Using AI to parse rate confirmation...');
  console.log('📋 First 2000 chars of extracted text:', text.substring(0, 2000));
  
  // Pre-extract the CORRECT rate using regex to guide AI
  let rateHint = '';
  
  // Try multiple patterns to find the payment amount
  const payCapacityMatch = text.match(/Pay Capacity\s+\$?([\d,]+\.\d{2})/i);
  const totalCarrierPayMatch = text.match(/Total Carrier Pay\s*:\s*\$?([\d,]+\.?\d*)/i);
  const carrierFreightPayMatch = text.match(/Carrier Freight Pay\s*:\s*\$?([\d,]+\.?\d*)/i);
  const totalDueMatch = text.match(/Total Due\s*\(USD\)\s*:\s*\$?([\d,]+\.?\d*)/i);
  const totalCostUsdMatch = text.match(/Total Cost\s+USD\s+([\d,]+\.\d{2})/i);
  const netFreightChargesMatch = text.match(/Net Freight Charges\s+USD\s+([\d,]+\.\d{2})/i);
  const usdTotalMatch = text.match(/USD Total[\s\S]*?\$?([\d,]+\.\d{2})/i);
  const totalOnlyMatch = text.match(/^TOTAL\s*\$?\s*([\d,]+\.\d{2})/im);
  const totalMatch = text.match(/Total:\s*\$?([\d,]+\.?\d*)/i);
  const baseAmountMatch = text.match(/BASE AMOUNT\s+\$?([\d,]+\.?\d*)/i);
  
  if (payCapacityMatch) {
  rateHint = payCapacityMatch[1].replace(/,/g, '');
  console.log(`💰 Pre-extracted Pay Capacity: $${rateHint}`);
} else if (totalCarrierPayMatch) {
  rateHint = totalCarrierPayMatch[1].replace(/,/g, '');
  console.log(`💰 Pre-extracted Total Carrier Pay: $${rateHint}`);
} else if (totalCostUsdMatch) {
    rateHint = totalCostUsdMatch[1].replace(/,/g, '');
    console.log(`💰 Pre-extracted Total Cost USD: $${rateHint}`);
  } else if (netFreightChargesMatch) {
    rateHint = netFreightChargesMatch[1].replace(/,/g, '');
    console.log(`💰 Pre-extracted Net Freight Charges: $${rateHint}`);
  } else if (carrierFreightPayMatch) {
    rateHint = carrierFreightPayMatch[1].replace(/,/g, '');
    console.log(`💰 Pre-extracted Carrier Freight Pay: $${rateHint}`);
  } else if (totalDueMatch) {
    rateHint = totalDueMatch[1].replace(/,/g, '');
    console.log(`💰 Pre-extracted Total Due: $${rateHint}`);
  } else if (usdTotalMatch) {
    rateHint = usdTotalMatch[1].replace(/,/g, '');
    console.log(`💰 Pre-extracted USD Total: $${rateHint}`);
  } else if (totalOnlyMatch) {
    const amount = parseFloat(totalOnlyMatch[1].replace(/,/g, ''));
    if (amount < 50000) {
      rateHint = totalOnlyMatch[1].replace(/,/g, '');
      console.log(`💰 Pre-extracted TOTAL line: $${rateHint}`);
    }
  } else if (baseAmountMatch) {
    rateHint = baseAmountMatch[1].replace(/,/g, '');
    console.log(`💰 Pre-extracted Base Amount: $${rateHint}`);
  } else if (totalMatch) {
    rateHint = totalMatch[1].replace(/,/g, '');
    console.log(`💰 Pre-extracted Total: $${rateHint}`);
  }

  // Pre-extract locations for Armstrong Transport format
  let pickupHint = '';
  let dropoffHint = '';
  const pickupMatch = text.match(/Pickup[\s\S]{0,200}?([A-Z\s]+),\s*([A-Z]{2}),?\s*(\d{5})/i);
  const dropoffMatch = text.match(/Dropoff[\s\S]{0,200}?([A-Z\s]+),\s*([A-Z]{2}),?\s*(\d{5})/i);

  if (pickupMatch) {
    const city = pickupMatch[1].trim().split('\n').pop()?.trim() || pickupMatch[1].trim();
    pickupHint = `${city}, ${pickupMatch[2]}`;
    console.log(`📍 Pre-extracted pickup: ${pickupHint}`);
  }
  if (dropoffMatch) {
    const city = dropoffMatch[1].trim().split('\n').pop()?.trim() || dropoffMatch[1].trim();
    dropoffHint = `${city}, ${dropoffMatch[2]}`;
    console.log(`📍 Pre-extracted dropoff: ${dropoffHint}`);
  }
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `You are parsing a trucking rate confirmation. Extract ONLY these fields as JSON:

CRITICAL INSTRUCTIONS:
1. grossAmount: ${rateHint ? `THE CORRECT AMOUNT IS $${rateHint}. Use this value.` : 'Find "Total Due (USD)", "Total:", "Rate:", or "Line Haul" in dollars.'} Extract ONLY the number.
2. loadNumber: Look for "Load #", "Load Number:", "TRIP #", "Shipment #", "Reference #", or "Order#". Return just the number.
3. driverName: Find "Primary Driver:", "Driver:", or "Driver Name" field. Extract FIRST name only in UPPERCASE.
4. pickupLocation: ${pickupHint ? `USE THIS VALUE: "${pickupHint}"` : 'Find "Pickup", "Shipper", or first stop location. Format as "City, State".'}.
5. dropoffLocation: ${dropoffHint ? `USE THIS VALUE: "${dropoffHint}"` : 'Find "Delivery", "Dropoff", "Consignee", or last stop location. Format as "City, State".'}.
6. miles: Find "Distance", "Miles", or calculate from locations. Return as integer.
7. pickupDate: Find pickup/shipper date. Convert MM/DD/YYYY to YYYY-MM-DD format.
8. deliveryDate: Find delivery/dropoff date. Convert MM/DD/YYYY to YYYY-MM-DD format.

Return EXACTLY this JSON structure with NO markdown, NO backticks:
{
  "loadNumber": "123456",
  "grossAmount": ${rateHint || '1000'},
  "driverName": "DRIVER",
  "truckNumber": "",
  "brokerName": "Broker Name",
  "pickupLocation": ${pickupHint ? `"${pickupHint}"` : '"City, ST"'},
  "dropoffLocation": ${dropoffHint ? `"${dropoffHint}"` : '"City, ST"'},
  "miles": 500,
  "pickupDate": "2025-01-01",
  "deliveryDate": "2025-01-02"
}

IMPORTANT: Look for a "STOPS" table or section. Pickup is the first location, Dropoff/Delivery is the last location.

Rate Confirmation Text:
${text.substring(0, 5000)}`
      }],
      temperature: 0,
      max_tokens: 500
    });
    
    const content = response.choices[0].message.content || '{}';
    const jsonText = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonText);
    
    if (rateHint && parsed.grossAmount && Math.abs(parsed.grossAmount - parseFloat(rateHint)) > 100) {
      console.log(`⚠️ AI returned $${parsed.grossAmount}, but regex found $${rateHint}. Using regex value.`);
      parsed.grossAmount = parseFloat(rateHint);
    }
    
    console.log('✅ AI extracted:', {
      load: parsed.loadNumber,
      amount: parsed.grossAmount,
      driver: parsed.driverName,
      pickup: parsed.pickupLocation,
      dropoff: parsed.dropoffLocation,
      pickupDate: parsed.pickupDate,
      deliveryDate: parsed.deliveryDate
    });
    
    return {
      loadNumber: parsed.loadNumber || '',
      grossAmount: Number(parsed.grossAmount) || 0,
      driverName: (parsed.driverName || '').toUpperCase(),
      truckNumber: parsed.truckNumber || '',
      trailerNumber: '',
      brokerName: parsed.brokerName || 'Unknown',
      pickupLocation: parsed.pickupLocation || '',
      dropoffLocation: parsed.dropoffLocation || '',
      miles: parsed.miles ? parseInt(parsed.miles) : null,
      pickupDate: parsed.pickupDate || null,
      deliveryDate: parsed.deliveryDate || null
    };
    
  } catch (error: any) {
    console.error('❌ AI parsing failed:', error.message);
    
    const loadNumber = text.match(/(?:TRIP #|Shipment #|Reference #|Load #|bill #)\s*(\d+)/i)?.[1] || '';
    const driverName = text.match(/Driver:\s*([A-Z][a-z]+)/i)?.[1]?.toUpperCase() || '';
    const miles = text.match(/Shipment Miles\s+(\d+)/i)?.[1] || null;
    const grossAmount = rateHint ? parseFloat(rateHint) : 0;
    
    console.log('📊 Regex fallback:', { loadNumber, driverName, grossAmount, miles });
    
    return {
      loadNumber,
      grossAmount,
      driverName,
      truckNumber: '',
      trailerNumber: '',
      brokerName: 'Unknown',
      pickupLocation: pickupHint || '',
      dropoffLocation: dropoffHint || '',
      miles: miles ? parseInt(miles) : null,
      pickupDate: null,
      deliveryDate: null
    };
  }
}

// Calculate distance
async function calculateDistance(origin: string, destination: string): Promise<number | null> {
  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
      params: { origins: origin, destinations: destination, key: process.env.GOOGLE_MAPS_API_KEY, units: 'imperial' }
    });
    const distance = response.data.rows[0]?.elements[0]?.distance?.value;
    return distance ? Math.round(distance * 0.000621371) : null;
  } catch (error) {
    console.error('Google Maps API error:', error);
    return null;
  }
}

// ============================================================================
// RATE CONFIRMATIONS
// ============================================================================

router.post('/upload-ratecon', uploadRatecons.array('files', 20), async (req: Request, res: Response): Promise<void> => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files?.length) {
      res.status(400).json({ success: false, error: 'No files uploaded' });
      return;
    }

    // Create batch record
    const fileNames = files.map(f => f.originalname).join(', ');
    const batchResult = await pool.query(`
      INSERT INTO upload_batches (batch_type, file_count, description, metadata)
      VALUES ('ratecons', $1, $2, $3)
      RETURNING id
    `, [
      files.length,
      `Rate Cons: ${fileNames.substring(0, 100)}`,
      JSON.stringify({ files: files.map(f => f.originalname) })
    ]);
    
    const batchId = batchResult.rows[0].id;
    console.log(`📦 Created batch #${batchId} for ${files.length} rate con(s)`);

    const processedLoads: any[] = [];
    const errors: string[] = [];

    for (const file of files) {
      try {
        console.log(`\n📄 Processing: ${file.originalname}`);
        
        const text = await extractPdfText(file.buffer);
        console.log(`📄 Extracted ${text.length} characters`);

        if (text.trim().length < 20) {
          errors.push(`${file.originalname}: No text extracted`);
          continue;
        }

        const parsed = await parseRateConfirmation(text);

        let driverId: number | null = null;
        let needsDriverAssignment = false;

        if (!parsed.driverName) {
          console.log(`⚠️ No driver name found in ${file.originalname}, will need manual assignment`);
          needsDriverAssignment = true;
        }
        if (!parsed.loadNumber) {
          errors.push(`${file.originalname}: Could not find load number`);
          continue;
        }

        // Calculate miles if missing
        if (!parsed.miles && parsed.pickupLocation && parsed.dropoffLocation) {
          const calculatedMiles = await calculateDistance(parsed.pickupLocation, parsed.dropoffLocation);
          if (calculatedMiles) parsed.miles = calculatedMiles;
        }

        // Find driver by name or alias
        const driverMatch = await findDriverByNameOrAlias(parsed.driverName);

        if (parsed.driverName && !needsDriverAssignment) {
          const driverMatch = await findDriverByNameOrAlias(parsed.driverName);
          
          if (driverMatch) {

          driverId = driverMatch.id;
          
          // If matched via alias, log it
          if (driverMatch.isAlias) {
            console.log(`✅ Matched "${parsed.driverName}" to driver ${driverMatch.name} via alias`);
          }
          
          // Update truck if provided
          if (parsed.truckNumber) {
            await pool.query('UPDATE drivers SET truck_id = $1 WHERE id = $2', [parsed.truckNumber, driverId]);
          }
        } else {
            // No match found - will need manual assignment
            console.log(`⚠️ Driver "${parsed.driverName}" not found, will need manual assignment`);
            needsDriverAssignment = true;
          }
        }

        // Upsert broker
        let brokerId: number;
        const brokerName = parsed.brokerName || 'Unknown';
        const brokerResult = await pool.query(
          'SELECT id FROM brokers WHERE LOWER(name) = LOWER($1)',
          [brokerName]
        );
        if (brokerResult.rows.length > 0) {
          brokerId = brokerResult.rows[0].id;
        } else {
          const newBroker = await pool.query(
            'INSERT INTO brokers (name) VALUES ($1) RETURNING id',
            [brokerName]
          );
          brokerId = newBroker.rows[0].id;
          console.log(`✅ Created broker: ${brokerName}`);
        }

        const netAmount = parsed.grossAmount * 0.978;

        const existingLoad = await pool.query(
          'SELECT id, load_number FROM loads WHERE broker_id = $1 AND load_number = $2',
          [brokerId, parsed.loadNumber]
        );
        
        const isDuplicate = existingLoad.rows.length > 0;
        if (isDuplicate) {
          console.log(`⚠️ DUPLICATE: Load ${parsed.loadNumber} already exists, updating...`);
        }

        const result = await pool.query(
          `INSERT INTO loads (
           broker_id, driver_id, load_number, gross_amount, net_amount,
           pickup_location, dropoff_location, miles, pickup_at, delivery_at,
           source_type, batch_id, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pdf',$11,NOW(),NOW())
           ON CONFLICT (broker_id, load_number) DO UPDATE SET
           gross_amount = EXCLUDED.gross_amount,
           net_amount = EXCLUDED.net_amount,
           miles = EXCLUDED.miles,
           updated_at = NOW()
           RETURNING *`,
          [
            brokerId, 
            needsDriverAssignment ? null : driverId, // Allow NULL driver_id
            parsed.loadNumber, 
            parsed.grossAmount, 
            netAmount,
            parsed.pickupLocation, 
            parsed.dropoffLocation, 
            parsed.miles,
            parsed.pickupDate || null, 
            parsed.deliveryDate || null,
            batchId
          ]
        );

        processedLoads.push({
          ...result.rows[0],
          driver_name: needsDriverAssignment ? null : parsed.driverName,
          broker_name: brokerName,
          is_duplicate: isDuplicate,
          needs_driver_assignment: needsDriverAssignment,
          suggested_driver_name: parsed.driverName || null
        });

      } catch (err: any) {
        console.error(`❌ Error processing ${file.originalname}:`, err);
        errors.push(`${file.originalname}: ${err.message}`);
      }
    }

    // Update batch with final count
    await pool.query(
      'UPDATE upload_batches SET record_count = $1 WHERE id = $2',
      [processedLoads.length, batchId]
    );

    const duplicateCount = processedLoads.filter(l => l.is_duplicate).length;
    const newCount = processedLoads.length - duplicateCount;
    const unassignedLoads = processedLoads.filter(l => l.needs_driver_assignment);

    console.log(`\n📊 Complete: ${newCount} new loads, ${duplicateCount} updated duplicates, ${unassignedLoads.length} need driver assignment, ${errors.length} errors`);

    res.json({
      success: true,
      processedCount: processedLoads.length,
      newCount,
      duplicateCount,
      loads: processedLoads,
      duplicates: processedLoads.filter(l => l.is_duplicate).map(l => l.load_number),
      unassignedLoads: unassignedLoads.map(l => ({
        id: l.id,
        loadNumber: l.load_number,
        grossAmount: parseFloat(l.gross_amount),
        miles: l.miles,
        suggestedDriverName: l.suggested_driver_name,
        pickupLocation: l.pickup_location,
        dropoffLocation: l.dropoff_location
      })),
      errors: errors.length ? errors : undefined
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, error: 'Failed to process rate confirmations' });
  }
});

// ============================================================================
// FUEL RECEIPTS
// ============================================================================

interface FuelReceipt {
  date: string;
  merchant: string;
  location?: string;
  gallons: number;
  pricePerGallon: number;
  totalAmount: number;
  driverName?: string;
  truckNumber?: string;
}

router.post('/upload-fuel', uploadMulti.array('fuel', 20), async (req: Request, res: Response): Promise<void> => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files?.length) {
      res.status(400).json({ success: false, error: 'No files uploaded' });
      return;
    }

    const processedReceipts: FuelReceipt[] = [];
    const errors: string[] = [];

    for (const file of files) {
      try {
        console.log(`⛽ Processing fuel file: ${file.originalname}`);
        
        let receipts: FuelReceipt[] = [];
        
        if (file.mimetype === 'application/pdf') {
          receipts = await parseFuelPDF(file.buffer);
        } else if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
          receipts = await parseFuelCSV(file.buffer);
        } else if (file.mimetype.includes('spreadsheet') || file.originalname.match(/\.xlsx?$/)) {
          receipts = await parseFuelXLSX(file.buffer);
        } else {
          errors.push(`${file.originalname}: Unsupported file type`);
          continue;
        }

        for (const receipt of receipts) {
          let driverId: number | null = null;
          if (receipt.driverName) {
            const driverResult = await pool.query(
              'SELECT id FROM drivers WHERE LOWER(name) = LOWER($1)',
              [receipt.driverName]
            );
            if (driverResult.rows.length > 0) {
              driverId = driverResult.rows[0].id;
            }
          }

          await pool.query(`
            INSERT INTO expenses (
              driver_id, category, amount, txn_at, merchant, 
              gallons, price_per_gallon, source
            ) VALUES ($1, 'fuel', $2, $3, $4, $5, $6, 'fuel')
          `, [
            driverId,
            receipt.totalAmount,
            receipt.date,
            receipt.merchant,
            receipt.gallons,
            receipt.pricePerGallon
          ]);
        }

        processedReceipts.push(...receipts);
        console.log(`✅ Processed ${receipts.length} fuel receipts from ${file.originalname}`);
        
      } catch (err: any) {
        console.error(`❌ Error processing ${file.originalname}:`, err);
        errors.push(`${file.originalname}: ${err.message}`);
      }
    }

    res.json({
      success: true,
      processedCount: processedReceipts.length,
      receipts: processedReceipts,
      errors: errors.length ? errors : undefined
    });

  } catch (error: any) {
    console.error('Fuel upload error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

async function parseFuelPDF(buffer: Buffer): Promise<FuelReceipt[]> {
  const text = await extractPdfText(buffer);
  
  if (text.trim().length < 20) {
    throw new Error('No text extracted from PDF');
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: `Extract fuel purchases. Return ONLY valid JSON array:

[{
  "date": "YYYY-MM-DD",
  "merchant": "merchant name",
  "location": "city, state",
  "gallons": number,
  "pricePerGallon": number,
  "totalAmount": number,
  "driverName": "driver name or null",
  "truckNumber": "truck number or null"
}]

Receipt: ${text.substring(0, 2000)}`
    }],
    temperature: 0,
    max_tokens: 500
  });

  const content = response.choices[0].message.content || '[]';
  const jsonText = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(jsonText);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function parseFuelCSV(buffer: Buffer): Promise<FuelReceipt[]> {
  const text = buffer.toString('utf-8');
  const lines = text.split('\n').filter(l => l.trim());
  
  if (lines.length < 2) {
    throw new Error('CSV file is empty');
  }

  const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
  const receipts: FuelReceipt[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const row: any = {};
    headers.forEach((header, idx) => { row[header] = values[idx]; });

    receipts.push({
      date: row.date || row.transaction_date || row.txn_date,
      merchant: row.merchant || row.location || row.station,
      location: row.city || row.location,
      gallons: parseFloat(row.gallons || row.quantity || '0'),
      pricePerGallon: parseFloat(row.price_per_gallon || row.ppu || row.unit_price || '0'),
      totalAmount: parseFloat(row.total || row.amount || row.total_amount || '0'),
      driverName: row.driver || row.driver_name,
      truckNumber: row.truck || row.truck_number
    });
  }

  return receipts;
}

async function parseFuelXLSX(buffer: Buffer): Promise<FuelReceipt[]> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data: any[] = XLSX.utils.sheet_to_json(sheet);
  const receipts: FuelReceipt[] = [];

  for (const row of data) {
    const keys = Object.keys(row).reduce((acc, key) => {
      acc[key.toLowerCase()] = row[key];
      return acc;
    }, {} as any);

    receipts.push({
      date: keys.date || keys.transaction_date,
      merchant: keys.merchant || keys.station,
      location: keys.city || keys.location,
      gallons: parseFloat(keys.gallons || keys.quantity || '0'),
      pricePerGallon: parseFloat(keys.price_per_gallon || keys.ppu || '0'),
      totalAmount: parseFloat(keys.total || keys.amount || '0'),
      driverName: keys.driver || keys.driver_name,
      truckNumber: keys.truck || keys.truck_number
    });
  }

  return receipts;
}

// ============================================================================
// DASHBOARD - SHOWS ALL DRIVERS INCLUDING $0 REVENUE
// ============================================================================

router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const { period = 'current_month', startDate, endDate, factoringRate = '2.2' } = req.query;
    const factoringPercent = parseFloat(factoringRate as string) / 100;
    
    let dateFilter = '';
    const now = new Date();
    
    if (period === 'custom' && startDate && endDate) {
      dateFilter = `AND l.pickup_at BETWEEN '${startDate}' AND '${endDate}'`;
    } else {
      switch (period) {
  case 'current_month':
    dateFilter = `AND EXTRACT(MONTH FROM l.pickup_at) = ${now.getMonth() + 1} 
                  AND EXTRACT(YEAR FROM l.pickup_at) = ${now.getFullYear()}`;
    break;
  case 'last_month':
    const lastMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const lastMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    dateFilter = `AND EXTRACT(MONTH FROM l.pickup_at) = ${lastMonth} 
                  AND EXTRACT(YEAR FROM l.pickup_at) = ${lastMonthYear}`;
    break;
  case 'ytd':
    dateFilter = `AND EXTRACT(YEAR FROM l.pickup_at) = ${now.getFullYear()}`;
    break;
  case 'last_year':
    dateFilter = `AND EXTRACT(YEAR FROM l.pickup_at) = ${now.getFullYear() - 1}`;
    break;
  default:
    const [year, month] = (period as string).split('-');
    if (year && month) {
      dateFilter = `AND EXTRACT(MONTH FROM l.pickup_at) = ${parseInt(month)} 
                    AND EXTRACT(YEAR FROM l.pickup_at) = ${parseInt(year)}`;
    }
}
    }

    // Get all active drivers first (including those without loads)
    const allDriversResult = await pool.query(`
  SELECT id, name, pay_rate 
  FROM drivers 
  WHERE active = true 
  AND LOWER(name) NOT IN ('john', 'test', 'demo', 'sample')
  ORDER BY name
`);

    // Get loads for drivers with loads
    const loadsResult = await pool.query(`
  SELECT l.*, d.name as driver_name, b.name as broker_name
  FROM loads l
  JOIN drivers d ON l.driver_id = d.id
  JOIN brokers b ON l.broker_id = b.id
  WHERE l.pickup_at IS NOT NULL ${dateFilter}
  ORDER BY d.name, l.pickup_at ASC
`);

    const fixedCostsResult = await pool.query(`
      SELECT d.id as driver_id, d.name as driver_name,
        COALESCE(SUM(
          COALESCE(fc.insurance,0) + COALESCE(fc.truck_payment,0) + COALESCE(fc.trailer_payment,0) +
          COALESCE(fc.cpa,0) + COALESCE(fc.eld,0) + COALESCE(fc.other,0)
        ), 0) as fixed_expenses
      FROM drivers d
      LEFT JOIN fixed_costs fc ON fc.driver_id = d.id
      WHERE d.active = true
      GROUP BY d.id, d.name
    `);

    const expensesResult = await pool.query(`
      SELECT driver_id, SUM(amount) as variable_expenses
      FROM expenses
      GROUP BY driver_id
    `);

    const driverMap = new Map<number, any>();

    // Initialize ALL active drivers in the map (even with $0 revenue)
    allDriversResult.rows.forEach(driver => {
      driverMap.set(driver.id, {
        driverName: driver.name,
        loads: [],
        grossRevenue: 0,
        totalMiles: 0
      });
    });

    // Add loads to drivers that have them
    loadsResult.rows.forEach(load => {
      if (!driverMap.has(load.driver_id)) {
        driverMap.set(load.driver_id, {
          driverName: load.driver_name,
          loads: [],
          grossRevenue: 0,
          totalMiles: 0
        });
      }

      const driver = driverMap.get(load.driver_id);
      driver.loads.push({
        id: load.id,
        loadNumber: load.load_number,
        grossAmount: parseFloat(load.gross_amount),
        netAmount: parseFloat(load.net_amount),
        lumper: parseFloat(load.lumper || 0),
        deadhead: load.deadhead || 0,
        miles: load.miles || 0,
        totalMiles: (load.miles || 0) + (load.deadhead || 0),
        ratePerMile: load.miles ? parseFloat(load.net_amount) / load.miles : 0,
        pickupLocation: load.pickup_location,
        dropoffLocation: load.dropoff_location,
        pickupDate: load.pickup_at,
        deliveryDate: load.delivery_at
      });
      driver.grossRevenue += parseFloat(load.gross_amount || 0);
      driver.totalMiles += (load.miles || 0) + (load.deadhead || 0);
    });

    const drivers = Array.from(driverMap.entries()).map(([driverId, driver]) => {
  const fixedCosts = fixedCostsResult.rows.find(f => f.driver_id === driverId) || { fixed_expenses: 0 };
  const expenses = expensesResult.rows.find(e => e.driver_id === driverId) || { variable_expenses: 0 };
  const driverInfo = allDriversResult.rows.find(d => d.id === driverId);
  const payRate = parseFloat(driverInfo?.pay_rate || 0);
  const driverPay = payRate * driver.totalMiles;

  const factoringFee = driver.grossRevenue * factoringPercent;
  const netRevenue = driver.grossRevenue - factoringFee;
  const fixedExpenses = parseFloat(fixedCosts.fixed_expenses || 0);
  const variableExpenses = parseFloat(expenses.variable_expenses || 0) + driverPay;
  const totalExpenses = fixedExpenses + variableExpenses;
  const netProfit = netRevenue - totalExpenses;

      const fixedCPM = driver.totalMiles > 0 ? fixedExpenses / driver.totalMiles : 0;
      const variableCPM = driver.totalMiles > 0 ? variableExpenses / driver.totalMiles : 0;
      const totalCPM = driver.totalMiles > 0 ? totalExpenses / driver.totalMiles : 0;
      const rpm = driver.totalMiles > 0 ? netRevenue / driver.totalMiles : 0;
      const profitPerMile = driver.totalMiles > 0 ? netProfit / driver.totalMiles : 0;

      return {
  ...driver,
  payRate,
  driverPay,
  factoringFee,
  netRevenue,
  fixedExpenses,
  variableExpenses,
  drivingExpenses: 0,
  totalExpenses,
  netProfit,
  fixedCPM,
  variableCPM,
  totalCPM,
  rpm,
  profitPerMile
};
    });

    const summary: any = {
      totalRevenue: drivers.reduce((sum, d) => sum + d.grossRevenue, 0),
      totalFactoring: drivers.reduce((sum, d) => sum + (d.grossRevenue * factoringPercent), 0),
      netRevenue: drivers.reduce((sum, d) => sum + (d.grossRevenue * (1 - factoringPercent)), 0),
      totalExpenses: drivers.reduce((sum, d) => sum + d.totalExpenses, 0),
      totalProfit: drivers.reduce((sum, d) => sum + d.netProfit, 0),
      totalMiles: drivers.reduce((sum, d) => sum + d.totalMiles, 0),
      factoringRate: factoringPercent * 100,
      drivers
    };

    summary.profitMargin = summary.totalRevenue > 0
      ? ((summary.totalProfit / summary.totalRevenue) * 100).toFixed(1)
      : '0.0';
    summary.avgRPM = summary.totalMiles > 0 ? summary.totalRevenue / summary.totalMiles : 0;
    summary.avgCPM = summary.totalMiles > 0 ? summary.totalExpenses / summary.totalMiles : 0;

    res.json({ success: true, summary, period: period || 'current_month' });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch dashboard data' });
  }
});

// ============================================================================
// EXPENSES BY DRIVER - FOR DASHBOARD BREAKDOWN
// ============================================================================

router.get('/expenses-by-driver', async (req: Request, res: Response): Promise<void> => {
  try {
    const { period = 'ytd' } = req.query;
    
    let dateFilter = '';
    const now = new Date();
    
    switch (period) {
      case 'ytd':
        dateFilter = `AND EXTRACT(YEAR FROM e.txn_at) = ${now.getFullYear()}`;
        break;
      case 'current_month':
        dateFilter = `AND EXTRACT(MONTH FROM e.txn_at) = ${now.getMonth() + 1} 
                      AND EXTRACT(YEAR FROM e.txn_at) = ${now.getFullYear()}`;
        break;
      case 'last_month':
        const lastMonth = now.getMonth() === 0 ? 12 : now.getMonth();
        const lastMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
        dateFilter = `AND EXTRACT(MONTH FROM e.txn_at) = ${lastMonth} 
                      AND EXTRACT(YEAR FROM e.txn_at) = ${lastMonthYear}`;
        break;
      case 'q1':
  dateFilter = `AND EXTRACT(QUARTER FROM l.pickup_at) = 1 AND EXTRACT(YEAR FROM l.pickup_at) = ${now.getFullYear()}`;
  break;
case 'q2':
  dateFilter = `AND EXTRACT(QUARTER FROM l.pickup_at) = 2 AND EXTRACT(YEAR FROM l.pickup_at) = ${now.getFullYear()}`;
  break;
case 'q3':
  dateFilter = `AND EXTRACT(QUARTER FROM l.pickup_at) = 3 AND EXTRACT(YEAR FROM l.pickup_at) = ${now.getFullYear()}`;
  break;
case 'q4':
  dateFilter = `AND EXTRACT(QUARTER FROM l.pickup_at) = 4 AND EXTRACT(YEAR FROM l.pickup_at) = ${now.getFullYear()}`;
  break;
    }

    // Get variable expenses from expenses table
    const variableExpenses = await pool.query(`
      SELECT 
        d.name as driver_name,
        e.expense_type,
        COALESCE(SUM(e.amount), 0) as total_amount
      FROM drivers d
      LEFT JOIN expenses e ON e.driver_id = d.id
      WHERE d.active = true ${dateFilter}
      GROUP BY d.name, e.expense_type
      ORDER BY d.name
    `);

    // Get fixed costs from fixed_costs table
    const fixedCosts = await pool.query(`
      SELECT 
        d.name as driver_name,
        COALESCE(fc.insurance, 0) as insurance,
        COALESCE(fc.truck_payment, 0) as truck_payment,
        COALESCE(fc.trailer_payment, 0) as trailer_payment,
        COALESCE(fc.cpa, 0) as cpa,
        COALESCE(fc.eld, 0) as eld,
        COALESCE(fc.prepass, 0) as prepass,
        COALESCE(fc.load_board, 0) as load_board,
        COALESCE(fc.ifta, 0) as ifta,
        COALESCE(fc.compliance, 0) as compliance,
        COALESCE(fc.payroll_tax, 0) as payroll_tax,
        COALESCE(fc.business_tax, 0) as business_tax,
        COALESCE(fc.interest_payments, 0) as interest_payments
      FROM drivers d
      LEFT JOIN fixed_costs fc ON fc.driver_id = d.id
      WHERE d.active = true
    `);

    const expensesByDriver: Record<string, Record<string, number>> = {};
    
    // Add variable expenses
    variableExpenses.rows.forEach(row => {
      if (!expensesByDriver[row.driver_name]) {
        expensesByDriver[row.driver_name] = {};
      }
      if (row.expense_type) {
        expensesByDriver[row.driver_name][row.expense_type] = parseFloat(row.total_amount);
      }
    });

    // Add fixed costs
    fixedCosts.rows.forEach(row => {
      if (!expensesByDriver[row.driver_name]) {
        expensesByDriver[row.driver_name] = {};
      }
      
      // Add each fixed cost column
      ['insurance', 'truck_payment', 'trailer_payment', 'cpa', 'eld', 'prepass', 
       'load_board', 'ifta', 'compliance', 'payroll_tax', 'business_tax', 'interest_payments'].forEach(col => {
        if (row[col] > 0) {
          expensesByDriver[row.driver_name][col] = parseFloat(row[col]);
        }
      });
    });

    res.json({
      success: true,
      expensesByDriver
    });

  } catch (error: any) {
    console.error('❌ Expenses by driver error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
// ============================================================================
// DRIVER MANAGEMENT (IMPROVED - FIXED VERSION)
// ============================================================================

// Create new driver - with better error handling and duplicate detection
router.post('/drivers', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ success: false, error: 'Driver name is required' });
      return;
    }

    const driverName = name.toUpperCase().trim();

    console.log(`📝 Attempting to create driver: "${driverName}"`);

    // Check for existing driver (case-insensitive)
    const existing = await pool.query(
      'SELECT id, name, active FROM drivers WHERE LOWER(name) = LOWER($1)',
      [driverName]
    );

    if (existing.rows.length > 0) {
      console.log(`✅ Driver "${driverName}" already exists (ID: ${existing.rows[0].id})`);
      res.json({
        success: true,
        driver: {
          id: existing.rows[0].id,
          name: existing.rows[0].name
        },
        message: `Driver ${driverName} already exists`
      });
      return;
    }

    // Create new driver
    try {
      const result = await pool.query(
        'INSERT INTO drivers (name, active) VALUES ($1, true) RETURNING id, name',
        [driverName]
      );

      console.log(`✅ Created new driver: ${driverName} (ID: ${result.rows[0].id})`);

      res.json({
        success: true,
        driver: {
          id: result.rows[0].id,
          name: result.rows[0].name
        }
      });

    } catch (insertError: any) {
      // Handle specific database errors
      console.error('❌ Database insert error:', insertError);
      
      if (insertError.code === '23505') {
        // Unique constraint violation
        res.status(409).json({ 
          success: false, 
          error: `Driver "${driverName}" already exists` 
        });
      } else if (insertError.code === '23502') {
        // Not null violation
        res.status(400).json({ 
          success: false, 
          error: 'Missing required driver information' 
        });
      } else {
        res.status(500).json({ 
          success: false, 
          error: `Database error: ${insertError.message}` 
        });
      }
    }

  } catch (error: any) {
    console.error('❌ Driver creation error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to create driver' });
  }
});


// Get all drivers - exclude test data
router.get('/drivers', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(`
      SELECT id, name, active, truck_id 
      FROM drivers 
      WHERE LOWER(name) NOT IN ('john', 'test', 'demo', 'sample')
      ORDER BY name
    `);

    res.json({
      success: true,
      drivers: result.rows
    });

  } catch (error: any) {
    console.error('❌ Get drivers error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Debug endpoint - check driver status (TEMPORARY - for debugging only)
router.get('/drivers/debug/:name', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;
    
    const exact = await pool.query(
      'SELECT * FROM drivers WHERE name = $1',
      [name.toUpperCase()]
    );
    
    const caseInsensitive = await pool.query(
      'SELECT * FROM drivers WHERE LOWER(name) = LOWER($1)',
      [name]
    );
    
    res.json({
      success: true,
      searched: name,
      exactMatch: exact.rows,
      caseInsensitiveMatch: caseInsensitive.rows,
      allDrivers: (await pool.query('SELECT id, name FROM drivers ORDER BY name')).rows
    });

  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// DRIVER ALIASES
// ============================================================================

// Get aliases for a driver
router.get('/drivers/:id/aliases', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'SELECT id, alias_name, created_at FROM driver_aliases WHERE driver_id = $1 ORDER BY alias_name',
      [parseInt(id)]
    );

    res.json({
      success: true,
      aliases: result.rows
    });

  } catch (error: any) {
    console.error('❌ Get aliases error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add alias to driver
router.post('/drivers/:id/aliases', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { aliasName } = req.body;

    if (!aliasName || !aliasName.trim()) {
      res.status(400).json({ success: false, error: 'Alias name is required' });
      return;
    }

    const normalizedAlias = aliasName.toUpperCase().trim();

    // Check if alias already exists for ANY driver
    const existingAlias = await pool.query(
      'SELECT da.*, d.name as driver_name FROM driver_aliases da JOIN drivers d ON da.driver_id = d.id WHERE LOWER(da.alias_name) = LOWER($1)',
      [normalizedAlias]
    );

    if (existingAlias.rows.length > 0) {
      res.status(409).json({ 
        success: false, 
        error: `Alias "${normalizedAlias}" already exists for driver ${existingAlias.rows[0].driver_name}` 
      });
      return;
    }

    // Create alias
    const result = await pool.query(
      'INSERT INTO driver_aliases (driver_id, alias_name) VALUES ($1, $2) RETURNING *',
      [parseInt(id), normalizedAlias]
    );

    console.log(`✅ Added alias "${normalizedAlias}" to driver ID ${id}`);

    res.json({
      success: true,
      alias: result.rows[0]
    });

  } catch (error: any) {
    console.error('❌ Add alias error:', error);
    if (error.code === '23505') {
      res.status(409).json({ success: false, error: 'This alias already exists for this driver' });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// Delete alias
router.delete('/drivers/:driverId/aliases/:aliasId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { driverId, aliasId } = req.params;
    
    const result = await pool.query(
      'DELETE FROM driver_aliases WHERE id = $1 AND driver_id = $2 RETURNING alias_name',
      [parseInt(aliasId), parseInt(driverId)]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Alias not found' });
      return;
    }

    console.log(`✅ Deleted alias "${result.rows[0].alias_name}" from driver ID ${driverId}`);

    res.json({ success: true, message: 'Alias deleted' });

  } catch (error: any) {
    console.error('❌ Delete alias error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// UPLOAD BATCH MANAGEMENT
// ============================================================================

// Get all upload batches
router.get('/batches', async (req: Request, res: Response): Promise<void> => {
  try {
    const { type } = req.query;
    
    let query = `
      SELECT 
        ub.*,
        CASE 
          WHEN ub.batch_type = 'ratecons' THEN (SELECT COUNT(*) FROM loads WHERE batch_id = ub.id)
          WHEN ub.batch_type = 'expenses' THEN (SELECT COUNT(*) FROM expenses WHERE batch_id = ub.id)
          ELSE 0
        END as current_record_count
      FROM upload_batches ub
      WHERE 1=1
    `;
    
    const params: any[] = [];
    
    if (type) {
      params.push(type);
      query += ` AND batch_type = $${params.length}`;
    }
    
    query += ' ORDER BY upload_date DESC LIMIT 50';
    
    const result = await pool.query(query, params);

    res.json({
      success: true,
      batches: result.rows
    });

  } catch (error: any) {
    console.error('❌ Get batches error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a batch (cascades to all loads/expenses)
router.delete('/batches/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    // Get batch info before deleting
    const batchInfo = await pool.query(
      'SELECT * FROM upload_batches WHERE id = $1',
      [parseInt(id)]
    );

    if (batchInfo.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Batch not found' });
      return;
    }

    const batch = batchInfo.rows[0];
    
    // Count records that will be deleted
    let recordCount = 0;
    if (batch.batch_type === 'ratecons') {
      const count = await pool.query('SELECT COUNT(*) FROM loads WHERE batch_id = $1', [parseInt(id)]);
      recordCount = parseInt(count.rows[0].count);
    } else if (batch.batch_type === 'expenses') {
      const count = await pool.query('SELECT COUNT(*) FROM expenses WHERE batch_id = $1', [parseInt(id)]);
      recordCount = parseInt(count.rows[0].count);
    }

    // Delete batch (cascades to loads/expenses)
    await pool.query('DELETE FROM upload_batches WHERE id = $1', [parseInt(id)]);

    console.log(`✅ Deleted batch #${id}: ${batch.batch_type} with ${recordCount} records`);

    res.json({
      success: true,
      message: `Deleted ${recordCount} ${batch.batch_type} records`,
      deleted: {
        batchId: parseInt(id),
        type: batch.batch_type,
        recordCount
      }
    });

  } catch (error: any) {
    console.error('❌ Delete batch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// LOAD MANAGEMENT
// ============================================================================

router.options('/loads/:id', (_req: Request, res: Response) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});

router.delete('/loads/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM loads WHERE id = $1 RETURNING *', [id]);
    
    if (result.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Load not found' });
      return;
    }
    
    res.json({ success: true, message: 'Load deleted', deleted: result.rows[0] });
  } catch (error: any) {
    console.error('Delete load error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to delete load' });
  }
});

router.put('/loads/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { gross_amount, miles, pickup_location, dropoff_location } = req.body;
    
    const net_amount = gross_amount * 0.978;
    
    const result = await pool.query(`
      UPDATE loads 
      SET gross_amount = $1, 
          net_amount = $2,
          miles = $3,
          pickup_location = $4,
          dropoff_location = $5,
          updated_at = NOW()
      WHERE id = $6
      RETURNING *
    `, [gross_amount, net_amount, miles, pickup_location, dropoff_location, id]);
    
    if (result.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Load not found' });
      return;
    }
    
    res.json({ success: true, load: result.rows[0] });
  } catch (error: any) {
    console.error('Update load error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to update load' });
  }
});

// Reassign load to different driver
router.put('/loads/:id/reassign', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { driverId } = req.body;

    if (!driverId) {
      res.status(400).json({ success: false, error: 'Driver ID required' });
      return;
    }

    const result = await pool.query(
      'UPDATE loads SET driver_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [driverId, id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Load not found' });
      return;
    }

    res.json({ success: true, load: result.rows[0] });
  } catch (error: any) {
    console.error('Reassign load error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Assign driver to load
router.post('/loads/:loadId/assign-driver', async (req: Request, res: Response): Promise<void> => {
  try {
    const { loadId } = req.params;
    const { driverId, createNewDriver, newDriverName } = req.body;

    let finalDriverId = driverId;

    // Create new driver if requested
    if (createNewDriver && newDriverName) {
      const normalizedName = newDriverName.toUpperCase().trim();
      
      // Check if driver already exists
      const existing = await pool.query(
        'SELECT id FROM drivers WHERE LOWER(name) = LOWER($1)',
        [normalizedName]
      );

      if (existing.rows.length > 0) {
        finalDriverId = existing.rows[0].id;
        console.log(`✅ Driver "${normalizedName}" already exists (ID: ${finalDriverId})`);
      } else {
        const newDriver = await pool.query(
          'INSERT INTO drivers (name, active) VALUES ($1, true) RETURNING id, name',
          [normalizedName]
        );
        finalDriverId = newDriver.rows[0].id;
        console.log(`✅ Created new driver: ${normalizedName} (ID: ${finalDriverId})`);
      }
    }

    if (!finalDriverId) {
      res.status(400).json({ success: false, error: 'No driver specified' });
      return;
    }

    // Update load with driver
    const result = await pool.query(
      'UPDATE loads SET driver_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [finalDriverId, loadId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Load not found' });
      return;
    }

    console.log(`✅ Assigned driver ID ${finalDriverId} to load #${loadId}`);

    res.json({
      success: true,
      load: result.rows[0],
      driverId: finalDriverId
    });

  } catch (error: any) {
    console.error('❌ Assign driver error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
/// Update or create manual expense entry
// Update or create manual expense entry
router.put('/expenses/:driverId/:category', async (req: Request, res: Response): Promise<void> => {
  try {
    const { driverId, category } = req.params;
    const { amount } = req.body;

    // Fixed costs go to fixed_costs table
    const fixedCostColumns: Record<string, string> = {
      'insurance': 'insurance',
      'truck_payment': 'truck_payment',
      'trailer_payment': 'trailer_payment',
      'cpa': 'cpa',
      'eld': 'eld',
      'prepass': 'prepass',
      'load_board': 'load_board',
      'ifta': 'ifta',
      'compliance': 'compliance',
      'payroll_tax': 'payroll_tax',
      'business_tax': 'business_tax',
      'interest_payments': 'interest_payments'
    };

    if (fixedCostColumns[category]) {
      // Update fixed_costs table
      const column = fixedCostColumns[category];
      const now = new Date();
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1); // First day of current month
      
      const existing = await pool.query(
        'SELECT id FROM fixed_costs WHERE driver_id = $1 AND month = $2',
        [driverId, currentMonth]
      );

      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE fixed_costs SET ${column} = $1, updated_at = NOW() WHERE driver_id = $2 AND month = $3`,
          [amount, driverId, currentMonth]
        );
      } else {
        await pool.query(
          `INSERT INTO fixed_costs (driver_id, month, ${column}, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
          [driverId, currentMonth, amount]
        );
      }
    } else {
      // Variable expenses go to expenses table
      const existing = await pool.query(
        'SELECT id FROM expenses WHERE driver_id = $1 AND expense_type = $2 AND source = $3',
        [driverId, category, 'manual']
      );

      if (existing.rows.length > 0) {
        await pool.query(
          'UPDATE expenses SET amount = $1, updated_at = NOW() WHERE id = $2',
          [amount, existing.rows[0].id]
        );
      } else {
        await pool.query(
          'INSERT INTO expenses (driver_id, expense_type, amount, txn_at, source, created_at) VALUES ($1, $2, $3, NOW(), $4, NOW())',
          [driverId, category, amount, 'manual']
        );
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Update expense error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update driver pay rate
router.put('/drivers/:id/pay-rate', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { payRate } = req.body;

    if (payRate === undefined || payRate < 0) {
      res.status(400).json({ success: false, error: 'Valid pay rate required' });
      return;
    }

    await pool.query(
      'UPDATE drivers SET pay_rate = $1 WHERE id = $2',
      [payRate, id]
    );

    res.json({ success: true });
  } catch (error: any) {
    console.error('Update pay rate error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;