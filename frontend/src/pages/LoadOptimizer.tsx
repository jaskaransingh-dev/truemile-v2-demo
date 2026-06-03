// ============================================================================
// LOAD OPTIMIZER - FRONTEND COMPONENT
// ============================================================================
// Screenshot → OCR → Score → Email Draft
// File: src/pages/LoadOptimizer.tsx
// ============================================================================

import { useState, useEffect } from 'react';
import { Upload, Camera, CheckCircle, AlertCircle, XCircle, Mail, Trash2 } from 'lucide-react';
import { API_URL } from '../config';

interface LoadCandidate {
  id: number;
  pickup_city: string;
  pickup_state: string;
  pickup_zip?: string;
  pickup_at?: string;
  drop_city: string;
  drop_state: string;
  drop_zip?: string;
  delivery_at?: string;
  rate?: number;
  miles?: number;
  rpm?: number;
  score: number;
  status: 'PASS' | 'REVIEW' | 'FAIL';
  reasons: string[];
  created_at: string;
}

export default function LoadOptimizer() {
  const [uploading, setUploading] = useState(false);
  const [currentCandidate, setCurrentCandidate] = useState<LoadCandidate | null>(null);
  const [ocrText, setOcrText] = useState('');
  const [candidates, setCandidates] = useState<LoadCandidate[]>([]);
  const [isDragging, setIsDragging] = useState(false);
    const [dispatchPlan, setDispatchPlan] = useState<any>(null);
    const [tripAnalysis, setTripAnalysis] = useState<any>(null);
  
  // Driver selection modal states
  const [showDriverModal, setShowDriverModal] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<LoadCandidate | null>(null);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [trucks, setTrucks] = useState<any[]>([]);
  const [trailers, setTrailers] = useState<any[]>([]);
  const [selectedDriver, setSelectedDriver] = useState('');
  const [selectedTruck, setSelectedTruck] = useState('');
  const [selectedTrailer, setSelectedTrailer] = useState('');

  // Fetch fleet data on mount
  useEffect(() => {
  fetchCandidates();
  fetchFleetData();
  fetchDispatchPlan();
}, []);

  const fetchFleetData = async () => {
    try {
      const [driversRes, trucksRes, trailersRes] = await Promise.all([
        fetch(`${API_URL}/api/fleet/drivers`),
        fetch(`${API_URL}/api/fleet/trucks`),
        fetch(`${API_URL}/api/fleet/trailers`)
      ]);
      
      const driversData = await driversRes.json();
      const trucksData = await trucksRes.json();
      const trailersData = await trailersRes.json();
      
      if (driversData.success) setDrivers(driversData.drivers);
      if (trucksData.success) setTrucks(trucksData.trucks);
      if (trailersData.success) setTrailers(trailersData.trailers);
    } catch (error) {
      console.error('Error fetching fleet data:', error);
    }
  };

  const fetchDispatchPlan = async () => {
  try {
    const response = await fetch(`${API_URL}/api/optimizer/dispatch-plan/active`);
    const data = await response.json();
    if (data.success && data.plan) {
      setDispatchPlan(data.plan);
      console.log('✅ Loaded dispatch plan:', data.plan);
    }
  } catch (error) {
    console.error('Error fetching dispatch plan:', error);
  }
};

  // Handle file upload (works for both click and drag-drop)
  const uploadFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('❌ Please upload an image file (PNG, JPEG, WEBP)');
      return;
    }

    setUploading(true);
    setCurrentCandidate(null);

    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch(`${API_URL}/api/optimizer/screenshot`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
  setCurrentCandidate(data.candidate);
  setOcrText(data.ocrText || '');
  setTripAnalysis(data.tripAnalysis || null);
  fetchCandidates();
  alert(`✅ Screenshot processed\nScore: ${data.score}\nStatus: ${data.status}`);
} else {
  alert(`❌ Failed to process: ${data.error}`);
}
    } catch (error: any) {
      console.error('Upload error:', error);
      alert(`❌ Failed to upload: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleScreenshotUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      await uploadFile(file);
    }
  };

  const fetchCandidates = async () => {
    try {
      const response = await fetch(`${API_URL}/api/optimizer/candidates?limit=20`);
      const data = await response.json();
      if (data.success) {
        setCandidates(data.candidates);
      }
    } catch (error) {
      console.error('Fetch candidates error:', error);
    }
  };

  // Show driver selection modal
  const generateEmailDraft = async (candidate: LoadCandidate) => {
    setSelectedCandidate(candidate);
    setShowDriverModal(true);
  };

  // Send email with selected driver/truck/trailer
  const sendEmailWithDriver = async () => {
    if (!selectedCandidate) return;
    
    const selectedDriverObj = drivers.find(d => d.id === selectedDriver);
    const selectedTruckObj = trucks.find(t => t.id === selectedTruck);
    const selectedTrailerObj = trailers.find(t => t.id === selectedTrailer);
    
    const truckInfo = selectedTruckObj 
      ? `${selectedTruckObj.year} ${selectedTruckObj.make} ${selectedTruckObj.model}`
      : '';
    const trailerInfo = selectedTrailerObj
      ? `${selectedTrailerObj.year} ${selectedTrailerObj.make} ${selectedTrailerObj.type} (${selectedTrailerObj.length}')`
      : '';
    
    try {
      const response = await fetch(`${API_URL}/api/outreach/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateId: selectedCandidate.id,
          driverName: selectedDriverObj?.name || '',
          truckInfo,
          trailerInfo
        }),
      });

      const data = await response.json();

      if (data.success) {
        setShowDriverModal(false);
        setSelectedDriver('');
        setSelectedTruck('');
        setSelectedTrailer('');
        if (data.sent) {
          alert('✅ Email sent successfully!');
        } else {
          alert('✅ Email draft created!');
        }
      } else {
        alert(`❌ Failed to generate email: ${data.error}`);
      }
    } catch (error: any) {
      alert(`❌ Error: ${error.message}`);
    }
  };

  const deleteCandidate = async (id: number) => {
    try {
      const response = await fetch(`${API_URL}/api/optimizer/candidates/${id}`, {
        method: 'DELETE',
      });
      
      const data = await response.json();
      
      if (data.success) {
        setCandidates(prev => prev.filter(c => c.id !== id));
        console.log('✅ Deleted candidate:', id);
      } else {
        console.error('❌ Delete failed:', data.error);
        alert('Failed to delete candidate');
      }
    } catch (error) {
      console.error('Delete error:', error);
      alert('Error deleting candidate');
    }
  };

  const StatusBadge = ({ status }: { status: string }) => {
    const colors = {
      PASS: { bg: '#dcfce7', text: '#16a34a', icon: CheckCircle },
      REVIEW: { bg: '#fef3c7', text: '#d97706', icon: AlertCircle },
      FAIL: { bg: '#fee2e2', text: '#dc2626', icon: XCircle },
    };

    const config = colors[status as keyof typeof colors];
    const Icon = config.icon;

    return (
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 12px',
        backgroundColor: config.bg,
        color: config.text,
        borderRadius: '12px',
        fontSize: '13px',
        fontWeight: '600'
      }}>
        <Icon size={14} />
        {status}
      </div>
    );
  };

  return (
    <div style={{ padding: '48px 64px' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', color: '#111827', marginBottom: '8px' }}>
          Load Optimizer
        </h1>
        <p style={{ fontSize: '14px', color: '#6b7280' }}>
          Upload screenshots from load boards to instantly score and qualify loads
        </p>
      </div>

      {/* Upload Section with Drag & Drop */}
      <div 
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          backgroundColor: isDragging ? '#eff6ff' : 'white',
          borderRadius: '16px',
          border: isDragging ? '2px dashed #2563eb' : '2px dashed #e5e7eb',
          padding: '48px',
          marginBottom: '32px',
          textAlign: 'center',
          transition: 'all 0.2s',
          cursor: 'pointer'
        }}
      >
        <Camera size={48} color={isDragging ? '#2563eb' : '#9ca3af'} style={{ margin: '0 auto 16px' }} />
        <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', marginBottom: '8px' }}>
          {isDragging ? 'Drop Screenshot Here' : 'Upload Load Screenshot'}
        </h3>
        <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px' }}>
          {isDragging ? 'Release to upload' : 'Drag & drop or click to upload from DAT, Truckstop, or any load board'}
        </p>

        <input
          type="file"
          id="screenshot-upload"
          accept="image/*"
          onChange={handleScreenshotUpload}
          style={{ display: 'none' }}
        />

        <label htmlFor="screenshot-upload">
          <button
            type="button"
            onClick={() => document.getElementById('screenshot-upload')?.click()}
            disabled={uploading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 24px',
              backgroundColor: uploading ? '#9ca3af' : '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: uploading ? 'not-allowed' : 'pointer'
            }}
          >
            <Upload size={16} />
            {uploading ? 'Processing...' : 'Click to Upload'}
          </button>
        </label>

        {uploading && (
          <p style={{ marginTop: '16px', fontSize: '13px', color: '#6b7280' }}>
            Performing OCR and scoring... this may take 10-15 seconds
          </p>
        )}
      </div>

      {/* Dispatch Targets Banner */}
      {dispatchPlan && (
        <div style={{
          backgroundColor: '#eff6ff',
          borderRadius: '12px',
          border: '1px solid #bfdbfe',
          padding: '20px',
          marginBottom: '24px'
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#1e40af', marginBottom: '12px' }}>
            Active Dispatch Plan: {dispatchPlan.driver_name}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Trip Target</div>
              <div style={{ fontSize: '18px', fontWeight: '600', color: '#111827' }}>
                {dispatchPlan.miles_per_trip?.toLocaleString()} mi
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Target RPM</div>
              <div style={{ fontSize: '18px', fontWeight: '600', color: '#111827' }}>
                ${dispatchPlan.avg_rpm_needed}/mi
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Revenue Goal</div>
              <div style={{ fontSize: '18px', fontWeight: '600', color: '#111827' }}>
                ${dispatchPlan.revenue_per_trip?.toLocaleString()}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Trip Duration</div>
              <div style={{ fontSize: '18px', fontWeight: '600', color: '#111827' }}>
                {dispatchPlan.days_otr} days
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trip Progress Analysis */}
{tripAnalysis && (
  <div style={{
    backgroundColor: tripAnalysis.status === 'above' ? '#dcfce7' : tripAnalysis.status === 'on-track' ? '#eff6ff' : '#fef3c7',
    borderRadius: '12px',
    border: `1px solid ${tripAnalysis.status === 'above' ? '#86efac' : tripAnalysis.status === 'on-track' ? '#bfdbfe' : '#fde68a'}`,
    padding: '20px',
    marginBottom: '24px'
  }}>
    <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px', color: '#111827' }}>
       Trip Progress Analysis (Load Duration: {tripAnalysis.currentLoad.estimatedDays} days)
    </h3>
    <p style={{ fontSize: '14px', marginBottom: '16px', color: '#374151' }}>
      {tripAnalysis.message}
    </p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '16px' }}>
      <div>
        <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Remaining Days</div>
        <div style={{ fontSize: '20px', fontWeight: '600', color: '#111827' }}>
          {tripAnalysis.remaining.days} days
        </div>
      </div>
      <div>
        <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>New Daily Miles Needed</div>
        <div style={{ fontSize: '20px', fontWeight: '600', color: tripAnalysis.status === 'below' ? '#dc2626' : '#16a34a' }}>
          {tripAnalysis.remaining.newDailyMiles} mi/day
        </div>
      </div>
      <div>
        <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Needed RPM (Rest of Trip)</div>
        <div style={{ fontSize: '20px', fontWeight: '600', color: tripAnalysis.status === 'below' ? '#dc2626' : '#16a34a' }}>
          ${tripAnalysis.remaining.rpm}/mi
        </div>
      </div>
      <div>
        <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Remaining Revenue</div>
        <div style={{ fontSize: '20px', fontWeight: '600', color: '#111827' }}>
          ${tripAnalysis.remaining.revenue.toLocaleString()}
        </div>
      </div>
    </div>
    {tripAnalysis.deficit && tripAnalysis.deficit.miles > 0 && (
      <div style={{ backgroundColor: '#fee2e2', borderRadius: '8px', padding: '12px', marginTop: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: '600', color: '#991b1b', marginBottom: '4px' }}>
          Mileage Deficit: {tripAnalysis.deficit.miles} miles behind in {tripAnalysis.deficit.days} day(s)
        </div>
        <div style={{ fontSize: '12px', color: '#7f1d1d' }}>
          Expected {tripAnalysis.targets.dailyMilesTarget}/day × {tripAnalysis.deficit.days} days = {tripAnalysis.targets.dailyMilesTarget * tripAnalysis.deficit.days} miles, but only did {currentCandidate!.miles}
        </div>
      </div>
    )}
  </div>
)}

      {/* Current Candidate */}
      {currentCandidate && (
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          border: '1px solid #e5e7eb',
          padding: '24px',
          marginBottom: '32px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '16px' }}>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', marginBottom: '4px' }}>
                Latest Load Analysis
              </h3>
              <p style={{ fontSize: '14px', color: '#6b7280' }}>
                {currentCandidate.pickup_city}, {currentCandidate.pickup_state} → {currentCandidate.drop_city}, {currentCandidate.drop_state}
              </p>
            </div>
            <StatusBadge status={currentCandidate.status} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '16px' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Score</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#111827' }}>{currentCandidate.score}/100</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Rate</div>
              <div style={{ fontSize: '20px', fontWeight: '600', color: '#111827' }}>
                ${currentCandidate.rate?.toLocaleString() || 'N/A'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Miles</div>
              <div style={{ fontSize: '20px', fontWeight: '600', color: '#111827' }}>
                {currentCandidate!.miles?.toLocaleString() || 'N/A'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>RPM</div>
              <div style={{ fontSize: '20px', fontWeight: '600', color: currentCandidate.rpm && Number(currentCandidate.rpm) >= 2.5 ? '#16a34a' : '#dc2626' }}>
                ${currentCandidate.rpm ? Number(currentCandidate.rpm).toFixed(2) : 'N/A'}
              </div>
            </div>
          </div>

          {currentCandidate.reasons.length > 0 && (
            <div style={{ backgroundColor: '#f9fafb', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: '#111827', marginBottom: '8px' }}>Analysis:</div>
              {currentCandidate.reasons.map((reason, idx) => (
                <div key={idx} style={{ fontSize: '13px', color: '#6b7280', marginBottom: '4px' }}>
                  • {reason}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => generateEmailDraft(currentCandidate)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '10px 20px',
                backgroundColor: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer'
              }}
            >
              <Mail size={16} />
              Send Email
            </button>
                      <button
            onClick={() => {
              setCurrentCandidate(null);
              setTripAnalysis(null);
            }}
            style={{
              padding: '10px 20px',
              backgroundColor: '#f3f4f6',
              color: '#374151',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
          >
            Clear
          </button>
          </div>
        </div>
      )}

      {/* Driver Selection Modal */}
      {showDriverModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '24px',
            width: '500px',
            maxWidth: '90vw'
          }}>
            <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
              Select Driver & Equipment
            </h3>
            
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '6px', color: '#374151' }}>
                Driver *
              </label>
              <select
                value={selectedDriver}
                onChange={(e) => setSelectedDriver(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              >
                <option value="">Select Driver</option>
                {drivers.map(driver => (
                  <option key={driver.id} value={driver.id}>{driver.name}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '6px', color: '#374151' }}>
                Truck (Optional)
              </label>
              <select
                value={selectedTruck}
                onChange={(e) => setSelectedTruck(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              >
                <option value="">Select Truck</option>
                {trucks.map(truck => (
                  <option key={truck.id} value={truck.id}>
                    {truck.year} {truck.make} {truck.model}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '6px', color: '#374151' }}>
                Trailer (Optional)
              </label>
              <select
                value={selectedTrailer}
                onChange={(e) => setSelectedTrailer(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              >
                <option value="">Select Trailer</option>
                {trailers.map(trailer => (
                  <option key={trailer.id} value={trailer.id}>
                    {trailer.year} {trailer.make} {trailer.type} ({trailer.length}')
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowDriverModal(false);
                  setSelectedDriver('');
                  setSelectedTruck('');
                  setSelectedTrailer('');
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#f3f4f6',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={sendEmailWithDriver}
                disabled={!selectedDriver}
                style={{
                  padding: '8px 16px',
                  backgroundColor: selectedDriver ? '#2563eb' : '#9ca3af',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: 'white',
                  cursor: selectedDriver ? 'pointer' : 'not-allowed'
                }}
              >
                Send Email
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recent Candidates */}
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        border: '1px solid #e5e7eb',
        overflow: 'hidden'
      }}>
        <div style={{ padding: '20px', borderBottom: '1px solid #e5e7eb' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827' }}>
            Recent Screenshots
          </h3>
        </div>

        {candidates.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>
            No screenshots analyzed yet. Upload one to get started!
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '13px' }}>
              <thead style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <tr>
                  <th style={{ padding: '12px 20px', textAlign: 'left', fontWeight: '600', color: '#6b7280' }}>Route</th>
                  <th style={{ padding: '12px 20px', textAlign: 'right', fontWeight: '600', color: '#6b7280' }}>Rate</th>
                  <th style={{ padding: '12px 20px', textAlign: 'right', fontWeight: '600', color: '#6b7280' }}>Miles</th>
                  <th style={{ padding: '12px 20px', textAlign: 'right', fontWeight: '600', color: '#6b7280' }}>RPM</th>
                  <th style={{ padding: '12px 20px', textAlign: 'right', fontWeight: '600', color: '#6b7280' }}>Score</th>
                  <th style={{ padding: '12px 20px', textAlign: 'center', fontWeight: '600', color: '#6b7280' }}>Status</th>
                  <th style={{ padding: '12px 20px', textAlign: 'center', fontWeight: '600', color: '#6b7280' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => (
                  <tr key={candidate.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '12px 20px', color: '#111827' }}>
                      {candidate.pickup_city}, {candidate.pickup_state} → {candidate.drop_city}, {candidate.drop_state}
                    </td>
                    <td style={{ padding: '12px 20px', textAlign: 'right', color: '#111827' }}>
                      ${candidate.rate?.toLocaleString() || '-'}
                    </td>
                    <td style={{ padding: '12px 20px', textAlign: 'right', color: '#111827' }}>
                      {candidate.miles?.toLocaleString() || '-'}
                    </td>
                    <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: '600', color: candidate.rpm && Number(candidate.rpm) >= 2.5 ? '#16a34a' : '#dc2626' }}>
                      ${candidate.rpm ? Number(candidate.rpm).toFixed(2) : '-'}
                    </td>
                    <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: '600', color: '#111827' }}>
                      {candidate.score}/100
                    </td>
                    <td style={{ padding: '12px 20px', textAlign: 'center' }}>
                      <StatusBadge status={candidate.status} />
                    </td>
                    <td style={{ padding: '12px 20px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button
                          onClick={() => generateEmailDraft(candidate)}
                          style={{
                            padding: '6px',
                            backgroundColor: '#f3f4f6',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                          title="Send email"
                        >
                          <Mail size={14} color="#374151" />
                        </button>
                        <button
                          onClick={() => deleteCandidate(candidate.id)}
                          style={{
                            padding: '6px',
                            backgroundColor: '#fee2e2',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                          title="Delete"
                        >
                          <Trash2 size={14} color="#dc2626" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}