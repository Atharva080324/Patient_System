'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  PERMANENT_TEETH,
  PRIMARY_TEETH,
  STANDARD_DENTAL_CONDITIONS,
  getToothLabel,
} from '@/lib/fdi-tooth';
import { clock } from '@/lib/clock';

interface PatientInfo {
  _id: string;
  patientCode: string;
  name: string;
  ageYears?: number;
  sex: string;
  phone: string;
  address?: string;
  allergies: string[];
}

interface VisitInfo {
  _id: string;
  token: number;
  date: string;
  type: string;
  status: string;
  version: number;
  reasonForVisit: string;
  isReadOnly: boolean;
  autoCalledIn: boolean;
}

interface PastVisit {
  _id: string;
  date: string;
  chiefComplaint: string;
  diagnosis: string;
  rxNumber?: string | null;
}

interface ToothFinding {
  tooth: number;
  condition: string;
  notes?: string;
}

interface CaseSheetData {
  _id?: string;
  version: number;
  chiefComplaint: string;
  history: string;
  medicalHistoryNotes: string;
  allergies: string[];
  examinationFindings: string;
  diagnosis: string;
  treatmentDoneOrAdvised: string;
  notes: string;
  teethEntries: ToothFinding[];
  updatedAt?: string;
}

interface PrescriptionItem {
  medicineId?: string;
  name: string;
  form: string;
  strength: string;
  dose: string;
  frequency: string;
  duration: string;
  instruction: string;
  note: string;
}

interface PrescriptionData {
  _id: string;
  status: 'DRAFT' | 'ISSUED' | 'VOID';
  rxNumber?: string;
  items: PrescriptionItem[];
  advice?: string;
  followUpDate?: string;
  language: 'en' | 'hi' | 'mr';
  version: number;
  printCount?: number;
  replacesPrescriptionId?: string;
  voidReason?: string;
  snapshot?: any;
}

interface MedicineResult {
  _id: string;
  genericName: string;
  brandName?: string;
  form: string;
  strength: string;
  source: string;
  verified: boolean;
  isFavorite: boolean;
  useCount: number;
}

interface PrescriptionSet {
  _id: string;
  name: string;
  items: any[];
}

export default function ConsultClient({ visitId }: { visitId: string }) {
  const router = useRouter();

  // Core state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [patient, setPatient] = useState<PatientInfo | null>(null);
  const [visit, setVisit] = useState<VisitInfo | null>(null);
  const [pastVisits, setPastVisits] = useState<PastVisit[]>([]);
  const [caseSheet, setCaseSheet] = useState<CaseSheetData>({
    version: 1,
    chiefComplaint: '',
    history: '',
    medicalHistoryNotes: '',
    allergies: [],
    examinationFindings: '',
    diagnosis: '',
    treatmentDoneOrAdvised: '',
    notes: '',
    teethEntries: [],
  });

  const [prescription, setPrescription] = useState<PrescriptionData | null>(null);
  const [prescriptionSets, setPrescriptionSets] = useState<PrescriptionSet[]>([]);

  // Autosave state
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'failed' | 'conflict'>('idle');
  const [lastSavedTime, setLastSavedTime] = useState<string>('');
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  // FDI Tooth Picker state
  const [toothView, setToothView] = useState<'permanent' | 'primary'>('permanent');
  const [selectedToothForModal, setSelectedToothForModal] = useState<number | null>(null);
  const [newToothCondition, setNewToothCondition] = useState<string>(STANDARD_DENTAL_CONDITIONS[0]);
  const [newToothNotes, setNewToothNotes] = useState<string>('');

  // Medicine search & Combobox state
  const [medicineQuery, setMedicineQuery] = useState('');
  const [medicineResults, setMedicineResults] = useState<MedicineResult[]>([]);
  const [isSearchingMeds, setIsSearchingMeds] = useState(false);
  const [showMedDropdown, setShowMedDropdown] = useState(false);

  // Custom medicine modal
  const [showCustomMedModal, setShowCustomMedModal] = useState(false);
  const [customGenName, setCustomGenName] = useState('');
  const [customBrandName, setCustomBrandName] = useState('');
  const [customForm, setCustomForm] = useState('tablet');
  const [customStrength, setCustomStrength] = useState('');

  // Void / Correction modal
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [isCorrecting, setIsCorrecting] = useState(false);

  // Save template modal
  const [showSaveSetModal, setShowSaveSetModal] = useState(false);
  const [newSetName, setNewSetName] = useState('');

  // Tab navigation inside consult screen
  const [activeTab, setActiveTab] = useState<'casesheet' | 'prescription'>('casesheet');

  // Debounce ref
  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const initialLoadDoneRef = useRef(false);
  const lastSavedPayloadRef = useRef<string>('');

  // Fetch consultation workspace data
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/consult/${visitId}`, { cache: 'no-store' });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load consultation data');
      }

      setPatient(data.patient);
      setVisit(data.visit);
      setPastVisits(data.pastVisits || []);
      if (data.caseSheet) {
        setCaseSheet(data.caseSheet);
        lastSavedPayloadRef.current = JSON.stringify({
          chiefComplaint: data.caseSheet.chiefComplaint || '',
          history: data.caseSheet.history || '',
          medicalHistoryNotes: data.caseSheet.medicalHistoryNotes || '',
          allergies: data.caseSheet.allergies || [],
          examinationFindings: data.caseSheet.examinationFindings || '',
          diagnosis: data.caseSheet.diagnosis || '',
          treatmentDoneOrAdvised: data.caseSheet.treatmentDoneOrAdvised || '',
          notes: data.caseSheet.notes || '',
          teethEntries: data.caseSheet.teethEntries || [],
        });
      }
      if (data.prescription) {
        setPrescription(data.prescription);
      } else {
        // Initialize local blank draft
        setPrescription({
          _id: '',
          status: 'DRAFT',
          items: [],
          advice: '',
          followUpDate: '',
          language: 'en',
          version: 1,
        });
      }

      // Also fetch prescription sets
      const setsRes = await fetch('/api/prescription-sets');
      if (setsRes.ok) {
        const setsData = await setsRes.json();
        setPrescriptionSets(setsData.sets || []);
      }
    } catch (err: any) {
      setError(err.message || 'Error loading consultation');
    } finally {
      setLoading(false);
      initialLoadDoneRef.current = true;
    }
  }, [visitId]);

  useEffect(() => {
    let active = true;
    void fetch(`/api/consult/${visitId}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setPatient(data.patient);
        setVisit(data.visit);
        setPastVisits(data.pastVisits || []);
        if (data.caseSheet) {
          setCaseSheet(data.caseSheet);
          lastSavedPayloadRef.current = JSON.stringify({
            chiefComplaint: data.caseSheet.chiefComplaint || '',
            history: data.caseSheet.history || '',
            medicalHistoryNotes: data.caseSheet.medicalHistoryNotes || '',
            allergies: data.caseSheet.allergies || [],
            examinationFindings: data.caseSheet.examinationFindings || '',
            diagnosis: data.caseSheet.diagnosis || '',
            treatmentDoneOrAdvised: data.caseSheet.treatmentDoneOrAdvised || '',
            notes: data.caseSheet.notes || '',
            teethEntries: data.caseSheet.teethEntries || [],
          });
        }
        if (data.prescription) {
          setPrescription(data.prescription);
        } else {
          setPrescription({
            _id: '',
            status: 'DRAFT',
            items: [],
            advice: '',
            followUpDate: '',
            language: 'en',
            version: 1,
          });
        }
        setLoading(false);
        initialLoadDoneRef.current = true;
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [visitId]);

  // Debounced autosave for case sheet
  useEffect(() => {
    if (!initialLoadDoneRef.current || !visit || visit.status !== 'IN_CONSULTATION') {
      return;
    }

    const currentPayload = JSON.stringify({
      chiefComplaint: caseSheet.chiefComplaint || '',
      history: caseSheet.history || '',
      medicalHistoryNotes: caseSheet.medicalHistoryNotes || '',
      allergies: caseSheet.allergies || [],
      examinationFindings: caseSheet.examinationFindings || '',
      diagnosis: caseSheet.diagnosis || '',
      treatmentDoneOrAdvised: caseSheet.treatmentDoneOrAdvised || '',
      notes: caseSheet.notes || '',
      teethEntries: caseSheet.teethEntries || [],
    });

    if (currentPayload === lastSavedPayloadRef.current) {
      return;
    }

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    setSaveStatus('saving');

    autosaveTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/consult/${visitId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            version: caseSheet.version,
            chiefComplaint: caseSheet.chiefComplaint,
            history: caseSheet.history,
            medicalHistoryNotes: caseSheet.medicalHistoryNotes,
            allergies: caseSheet.allergies,
            examinationFindings: caseSheet.examinationFindings,
            diagnosis: caseSheet.diagnosis,
            treatmentDoneOrAdvised: caseSheet.treatmentDoneOrAdvised,
            notes: caseSheet.notes,
            teethEntries: caseSheet.teethEntries,
          }),
        });

        const resData = await res.json();

        if (res.status === 409) {
          setSaveStatus('conflict');
          setConflictMessage(
            resData.error || 'Conflict detected: Case sheet was modified in another tab or window.'
          );
          return;
        }

        if (!res.ok) {
          throw new Error(resData.error || 'Failed to autosave case sheet');
        }

        // Successfully saved
        lastSavedPayloadRef.current = currentPayload;
        setCaseSheet((prev) => ({
          ...prev,
          version: resData.caseSheet.version,
        }));
        setSaveStatus('saved');
        const now = clock.now();
        setLastSavedTime(
          now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        );
        setConflictMessage(null);
      } catch (err: any) {
        console.error('Autosave error:', err);
        setSaveStatus('failed');
      }
    }, 1000);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [caseSheet, visitId, visit]);

  // Medicine search triggered on typing
  useEffect(() => {
    let active = true;
    const delayTimer = setTimeout(async () => {
      setIsSearchingMeds(true);
      try {
        const res = await fetch(`/api/medicines?q=${encodeURIComponent(medicineQuery)}&limit=15`);
        if (res.ok && active) {
          const data = await res.json();
          setMedicineResults(data.results || []);
        }
      } catch (err) {
        console.error('Med search error:', err);
      } finally {
        if (active) setIsSearchingMeds(false);
      }
    }, 150);

    return () => {
      active = false;
      clearTimeout(delayTimer);
    };
  }, [medicineQuery]);

  // Handle Complete Visit
  const handleCompleteVisit = async () => {
    try {
      const res = await fetch(`/api/consult/${visitId}/complete`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to complete visit');
      }
      window.location.href = '/queue';
    } catch (err: any) {
      console.error('Complete visit error:', err);
    }
  };

  // Add tooth finding to CaseSheet
  const handleAddToothFinding = () => {
    if (selectedToothForModal === null) return;
    const newEntry: ToothFinding = {
      tooth: selectedToothForModal,
      condition: newToothCondition,
      notes: newToothNotes.trim(),
    };

    setCaseSheet((prev) => ({
      ...prev,
      teethEntries: [...prev.teethEntries.filter((t) => t.tooth !== selectedToothForModal), newEntry],
    }));

    setSelectedToothForModal(null);
    setNewToothNotes('');
  };

  // Remove tooth finding from CaseSheet
  const handleRemoveToothFinding = (toothNumber: number) => {
    setCaseSheet((prev) => ({
      ...prev,
      teethEntries: prev.teethEntries.filter((t) => t.tooth !== toothNumber),
    }));
  };

  // Medicine line items management
  const handleAddMedicineLine = (med: MedicineResult) => {
    setPrescription((prev) => {
      if (!prev) return null;
      const newLine: PrescriptionItem = {
        medicineId: med._id,
        name: med.brandName ? `${med.brandName} (${med.genericName})` : med.genericName,
        form: med.form,
        strength: med.strength,
        dose: '',
        frequency: '',
        duration: '',
        instruction: '',
        note: '',
      };
      return {
        ...prev,
        items: [...prev.items, newLine],
      };
    });
    setMedicineQuery('');
    setShowMedDropdown(false);
  };

  const handleUpdateMedicineLine = (index: number, field: keyof PrescriptionItem, value: string) => {
    setPrescription((prev) => {
      if (!prev) return null;
      const items = [...prev.items];
      items[index] = { ...items[index], [field]: value };
      return { ...prev, items };
    });
  };

  const handleRemoveMedicineLine = (index: number) => {
    setPrescription((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        items: prev.items.filter((_, i) => i !== index),
      };
    });
  };

  // Toggle favorite medicine
  const handleToggleFavorite = async (e: React.MouseEvent, medId: string) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/medicines/${medId}/favorite`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setMedicineResults((prev) =>
          prev.map((m) => (m._id === medId ? { ...m, isFavorite: data.isFavorite } : m))
        );
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Save Prescription Draft
  const handleSavePrescriptionDraft = async () => {
    if (!prescription) return;
    try {
      const res = await fetch(`/api/prescriptions/${visitId}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: prescription.items,
          advice: prescription.advice,
          followUpDate: prescription.followUpDate,
          language: prescription.language,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save draft');
      setPrescription((prev) => (prev ? { ...prev, _id: data.prescription._id } : null));
      alert('Prescription draft saved.');
    } catch (err: any) {
      alert(`Error saving draft: ${err.message}`);
    }
  };

  // Issue Prescription
  const handleIssuePrescription = async () => {
    if (!prescription) return;
    if (prescription.items.length === 0) {
      alert('Please add at least one medicine item before issuing a prescription.');
      return;
    }

    if (!confirm('Issue this prescription? Once issued, it will be numbered and permanently immutable.')) {
      return;
    }

    try {
      // First ensure draft is saved
      const draftRes = await fetch(`/api/prescriptions/${visitId}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: prescription.items,
          advice: prescription.advice,
          followUpDate: prescription.followUpDate,
          language: prescription.language,
        }),
      });
      const draftData = await draftRes.json();
      if (!draftRes.ok) throw new Error(draftData.error || 'Failed to save draft');

      const rxId = draftData.prescription._id;
      const issueRes = await fetch(`/api/prescriptions/${rxId}/issue`, { method: 'POST' });
      const issueData = await issueRes.json();
      if (!issueRes.ok) throw new Error(issueData.error || 'Failed to issue prescription');

      setPrescription(issueData.prescription);
      alert(`Prescription ISSUED successfully: ${issueData.prescription.rxNumber}`);
    } catch (err: any) {
      alert(`Error issuing prescription: ${err.message}`);
    }
  };

  // Void or Correct Prescription
  const handleVoidOrCorrect = async () => {
    if (!prescription || !prescription._id) return;
    if (!voidReason.trim()) {
      alert('Please provide a mandatory reason for voiding this prescription.');
      return;
    }

    try {
      const endpoint = isCorrecting
        ? `/api/prescriptions/${prescription._id}/correct`
        : `/api/prescriptions/${prescription._id}/void`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voidReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed action');

      setShowVoidModal(false);
      setVoidReason('');

      if (isCorrecting) {
        setPrescription(data.prescription);
        alert('Previous prescription voided. A new editable correction draft has been opened.');
      } else {
        setPrescription((prev) => (prev ? { ...prev, status: 'VOID', voidReason } : null));
        alert('Prescription marked as VOID.');
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  // Add Custom Medicine
  const handleCreateCustomMedicine = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/medicines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          genericName: customGenName,
          brandName: customBrandName,
          form: customForm,
          strength: customStrength,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create custom medicine');

      setShowCustomMedModal(false);
      setCustomGenName('');
      setCustomBrandName('');
      setCustomStrength('');
      handleAddMedicineLine({
        _id: data.medicine._id,
        genericName: data.medicine.genericName,
        brandName: data.medicine.brandName,
        form: data.medicine.form,
        strength: data.medicine.strength,
        source: 'CUSTOM',
        verified: true,
        isFavorite: false,
        useCount: 0,
      });
    } catch (err: any) {
      alert(`Error creating custom medicine: ${err.message}`);
    }
  };

  // Apply Prescription Set (Template)
  const handleApplySet = (setId: string) => {
    const selected = prescriptionSets.find((s) => s._id === setId);
    if (!selected) return;

    if (
      prescription?.items &&
      prescription.items.length > 0 &&
      !confirm('Applying this template will append its medicines to your current list. Continue?')
    ) {
      return;
    }

    const newItems: PrescriptionItem[] = selected.items.map((item) => ({
      name: item.medicineSnapshot?.name || 'Medicine',
      form: item.medicineSnapshot?.form || 'tablet',
      strength: item.medicineSnapshot?.strength || '',
      dose: item.dose || '',
      frequency: item.frequency || '',
      duration: item.duration || '',
      instruction: item.instructions || '',
      note: '',
    }));

    setPrescription((prev) => ({
      ...prev!,
      items: [...(prev?.items || []), ...newItems],
    }));
  };

  // Save current lines as a Template Set
  const handleSaveAsSet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSetName.trim() || !prescription || prescription.items.length === 0) return;

    try {
      const res = await fetch('/api/prescription-sets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSetName.trim(),
          items: prescription.items.map((item) => ({
            name: item.name,
            form: item.form,
            strength: item.strength,
            dose: item.dose,
            frequency: item.frequency,
            duration: item.duration,
            instructions: item.instruction,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create set');

      setPrescriptionSets((prev) => [...prev, data.set]);
      setShowSaveSetModal(false);
      setNewSetName('');
      alert(`Template "${data.set.name}" saved successfully.`);
    } catch (err: any) {
      alert(`Error saving template: ${err.message}`);
    }
  };

  // Copy local text if 409 conflict occurs
  const handleCopyConflictText = () => {
    const summary = [
      `Chief Complaint: ${caseSheet.chiefComplaint}`,
      `History: ${caseSheet.history}`,
      `Examination Findings: ${caseSheet.examinationFindings}`,
      `Diagnosis: ${caseSheet.diagnosis}`,
      `Treatment: ${caseSheet.treatmentDoneOrAdvised}`,
      `Notes: ${caseSheet.notes}`,
    ].join('\n\n');

    navigator.clipboard.writeText(summary);
    alert('Case sheet text copied to clipboard!');
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-6">
        <div className="flex items-center space-x-3 text-lg font-medium text-emerald-400">
          <svg className="animate-spin h-6 w-6 text-emerald-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span>Loading patient consultation workspace...</span>
        </div>
      </main>
    );
  }

  if (error || !patient || !visit) {
    return (
      <main className="min-h-screen bg-slate-900 text-slate-100 p-8 flex flex-col items-center justify-center">
        <div className="max-w-md w-full bg-slate-800 border border-rose-500/30 rounded-xl p-6 text-center shadow-xl">
          <h1 className="text-xl font-bold text-rose-400 mb-2">Consultation Unavailable</h1>
          <p className="text-slate-300 text-sm mb-6">{error || 'Visit record could not be loaded.'}</p>
          <Link
            href="/queue"
            className="inline-flex items-center px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-semibold transition"
          >
            ← Return to Live Queue
          </Link>
        </div>
      </main>
    );
  }

  const patientAllergies = caseSheet.allergies || patient.allergies || [];
  const hasAllergies = patientAllergies.length > 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* 1. Header Block */}
      <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 py-3 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <Link
              href="/queue"
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition focus:outline-none focus:ring-2 focus:ring-emerald-400"
              title="Return to Live Queue"
            >
              ← Queue
            </Link>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-700/50 text-xs font-bold">
                  Token #{visit.token}
                </span>
                <h1 id="consult-patient-name" className="text-lg font-bold text-white tracking-tight">{patient.name}</h1>
                <span className="text-xs text-slate-400 font-mono">({patient.patientCode})</span>
              </div>
              <p className="text-xs text-slate-400">
                {patient.ageYears ? `${patient.ageYears}y` : ''} • {patient.sex} • 📞 {patient.phone} •{' '}
                <span className="text-amber-300">Reason: {visit.reasonForVisit}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Autosave Indicator */}
            <div className="text-xs font-mono px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700 flex items-center space-x-2">
              {saveStatus === 'saving' && (
                <>
                  <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
                  <span className="text-amber-300">Autosaving...</span>
                </>
              )}
              {saveStatus === 'saved' && (
                <>
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="text-emerald-300">Saved {lastSavedTime}</span>
                </>
              )}
              {saveStatus === 'failed' && (
                <>
                  <span className="h-2 w-2 rounded-full bg-rose-500" />
                  <span className="text-rose-300">Save Failed (Retrying...)</span>
                </>
              )}
              {saveStatus === 'conflict' && (
                <>
                  <span className="h-2 w-2 rounded-full bg-rose-500 animate-bounce" />
                  <span className="text-rose-400 font-bold">Version Conflict!</span>
                </>
              )}
              {saveStatus === 'idle' && (
                <span className="text-slate-400">Ready</span>
              )}
            </div>

            {/* Phase 4 Billing & Estimate Entry Points */}
            <Link
              id="btn-consult-create-estimate"
              href={`/billing/estimates/new?visitId=${visit._id}&patientId=${patient._id}`}
              className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold border border-slate-700 shadow-sm transition"
            >
              + Estimate
            </Link>
            <Link
              id="btn-consult-create-bill"
              href={`/billing/bills/new?visitId=${visit._id}&patientId=${patient._id}`}
              className="px-3.5 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-xs font-semibold shadow-sm transition"
            >
              + Bill
            </Link>

            {/* Complete Visit Button */}
            {visit.status === 'IN_CONSULTATION' && (
              <button
                type="button"
                id="btn-complete-visit"
                onClick={handleCompleteVisit}
                className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-slate-900"
              >
                ✓ Complete Visit
              </button>
            )}

            {visit.status === 'COMPLETED' && (
              <span className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs font-bold uppercase tracking-wider">
                Visit Completed (Read-Only)
              </span>
            )}
          </div>
        </div>

        {/* 2. Allergy Reminder Chip (informational only; never blocks prescribing) */}
        {hasAllergies && (
          <div
            id="allergy-reminder-chip"
            role="alert"
            className="max-w-7xl mx-auto mt-2.5 px-3 py-1.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs font-medium flex items-center space-x-2"
          >
            <span className="text-base">⚠️</span>
            <span>
              <strong>Allergy Reminder:</strong> {patientAllergies.join(', ')} (Doctor clinical decision required)
            </span>
          </div>
        )}

        {/* Conflict Warning Banner */}
        {saveStatus === 'conflict' && conflictMessage && (
          <div
            role="alert"
            className="max-w-7xl mx-auto mt-2 px-4 py-3 rounded-md bg-rose-950/80 border border-rose-500 text-rose-200 text-sm flex items-center justify-between gap-4"
          >
            <div>
              <p className="font-bold">⚠️ Concurrency Conflict</p>
              <p className="text-xs text-rose-300">{conflictMessage}</p>
            </div>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                id="btn-copy-conflict-text"
                onClick={handleCopyConflictText}
                className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white border border-slate-600"
              >
                Copy My Text
              </button>
              <button
                type="button"
                id="btn-reload-latest"
                onClick={fetchData}
                className="px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white"
              >
                Reload Latest
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Sidebar: Patient Past History & Clinical Summary */}
        <aside className="lg:col-span-3 space-y-4">
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
              Previous Visits ({pastVisits.length})
            </h2>
            {pastVisits.length === 0 ? (
              <p className="text-xs text-slate-400 italic">First visit at clinic. No prior history.</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                {pastVisits.map((pv) => (
                  <div
                    key={pv._id}
                    className="p-2.5 rounded-lg bg-slate-800/60 border border-slate-750 text-xs space-y-1"
                  >
                    <div className="flex justify-between items-center text-slate-400">
                      <span className="font-mono">{pv.date}</span>
                      {pv.rxNumber && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-950 text-blue-400 font-mono text-[10px]">
                          {pv.rxNumber}
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-slate-200 truncate">{pv.chiefComplaint}</p>
                    {pv.diagnosis && <p className="text-slate-400 italic text-[11px]">{pv.diagnosis}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Quick Actions / Navigation */}
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Workspace Navigation</h2>
            <button
              type="button"
              id="tab-btn-casesheet"
              onClick={() => setActiveTab('casesheet')}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition ${
                activeTab === 'casesheet'
                  ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              📋 Case Sheet & Dental Chart
            </button>
            <button
              type="button"
              id="tab-btn-prescription"
              onClick={() => setActiveTab('prescription')}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition ${
                activeTab === 'prescription'
                  ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              💊 Prescription ({prescription?.items?.length || 0} items)
            </button>
          </section>
        </aside>

        {/* Right Main Column: Tab content */}
        <section className="lg:col-span-9 space-y-6">
          {activeTab === 'casesheet' && (
            <div className="space-y-6">
              {/* Case Sheet Form */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow space-y-6">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h2 className="text-lg font-bold text-white flex items-center space-x-2">
                    <span>Clinical Case Sheet</span>
                    <span className="text-xs text-slate-400 font-mono">(v{caseSheet.version})</span>
                  </h2>
                  <span className="text-xs text-slate-400">All fields auto-save while typing</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="cs-chief-complaint" className="block text-xs font-medium text-slate-300 mb-1">
                      Chief Complaint *
                    </label>
                    <textarea
                      id="cs-chief-complaint"
                      rows={2}
                      disabled={visit.status !== 'IN_CONSULTATION'}
                      value={caseSheet.chiefComplaint}
                      onChange={(e) => setCaseSheet((prev) => ({ ...prev, chiefComplaint: e.target.value }))}
                      placeholder="e.g. Pain in lower right molar since 3 days"
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 p-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label htmlFor="cs-diagnosis" className="block text-xs font-medium text-slate-300 mb-1">
                      Diagnosis *
                    </label>
                    <textarea
                      id="cs-diagnosis"
                      rows={2}
                      disabled={visit.status !== 'IN_CONSULTATION'}
                      value={caseSheet.diagnosis}
                      onChange={(e) => setCaseSheet((prev) => ({ ...prev, diagnosis: e.target.value }))}
                      placeholder="e.g. Irreversible Pulpitis #46"
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 p-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                {/* History & Allergies */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="cs-history" className="block text-xs font-medium text-slate-300 mb-1">
                      History of Present Illness
                    </label>
                    <textarea
                      id="cs-history"
                      rows={2}
                      disabled={visit.status !== 'IN_CONSULTATION'}
                      value={caseSheet.history}
                      onChange={(e) => setCaseSheet((prev) => ({ ...prev, history: e.target.value }))}
                      placeholder="Onset, duration, nature of pain..."
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 p-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label htmlFor="cs-medical-history" className="block text-xs font-medium text-slate-300 mb-1">
                      Medical History / Systemic Notes
                    </label>
                    <textarea
                      id="cs-medical-history"
                      rows={2}
                      disabled={visit.status !== 'IN_CONSULTATION'}
                      value={caseSheet.medicalHistoryNotes}
                      onChange={(e) => setCaseSheet((prev) => ({ ...prev, medicalHistoryNotes: e.target.value }))}
                      placeholder="Diabetes, Hypertension, Bleeding disorders..."
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 p-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label htmlFor="cs-allergies" className="block text-xs font-medium text-slate-300 mb-1">
                      Known Allergies (Comma-separated)
                    </label>
                    <textarea
                      id="cs-allergies"
                      rows={2}
                      disabled={visit.status !== 'IN_CONSULTATION'}
                      value={caseSheet.allergies.join(', ')}
                      onChange={(e) => {
                        const arr = e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean);
                        setCaseSheet((prev) => ({ ...prev, allergies: arr }));
                      }}
                      placeholder="e.g. Penicillin, Sulfa"
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 p-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                {/* Examination Findings & Treatment Advised */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="cs-exam-findings" className="block text-xs font-medium text-slate-300 mb-1">
                      Examination Findings (Clinical & Radiographic)
                    </label>
                    <textarea
                      id="cs-exam-findings"
                      rows={3}
                      disabled={visit.status !== 'IN_CONSULTATION'}
                      value={caseSheet.examinationFindings}
                      onChange={(e) => setCaseSheet((prev) => ({ ...prev, examinationFindings: e.target.value }))}
                      placeholder="Carious lesion #46, tenderness on vertical percussion..."
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 p-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label htmlFor="cs-treatment" className="block text-xs font-medium text-slate-300 mb-1">
                      Treatment Done / Advised
                    </label>
                    <textarea
                      id="cs-treatment"
                      rows={3}
                      disabled={visit.status !== 'IN_CONSULTATION'}
                      value={caseSheet.treatmentDoneOrAdvised}
                      onChange={(e) => setCaseSheet((prev) => ({ ...prev, treatmentDoneOrAdvised: e.target.value }))}
                      placeholder="Root canal therapy initiated: Access cavity prepared, working length determined..."
                      className="w-full rounded-lg bg-slate-800 border border-slate-700 p-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                {/* Additional Clinical Notes */}
                <div>
                  <label htmlFor="cs-notes" className="block text-xs font-medium text-slate-300 mb-1">
                    Doctor Notes / Post-Op Instructions
                  </label>
                  <textarea
                    id="cs-notes"
                    rows={2}
                    disabled={visit.status !== 'IN_CONSULTATION'}
                    value={caseSheet.notes}
                    onChange={(e) => setCaseSheet((prev) => ({ ...prev, notes: e.target.value }))}
                    placeholder="Patient instructed to avoid chewing on right side until temporary restoration..."
                    className="w-full rounded-lg bg-slate-800 border border-slate-700 p-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* FDI Tooth Chart & Picker */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div>
                    <h2 className="text-base font-bold text-white">FDI Two-Digit Dental Chart</h2>
                    <p className="text-xs text-slate-400">Click or focus any tooth to record condition or procedure</p>
                  </div>
                  <div className="flex rounded-lg bg-slate-800 p-1 border border-slate-700">
                    <button
                      type="button"
                      id="btn-tooth-permanent"
                      onClick={() => setToothView('permanent')}
                      className={`px-3 py-1 rounded text-xs font-semibold transition ${
                        toothView === 'permanent'
                          ? 'bg-emerald-700 text-white'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      Permanent (11-48)
                    </button>
                    <button
                      type="button"
                      id="btn-tooth-primary"
                      onClick={() => setToothView('primary')}
                      className={`px-3 py-1 rounded text-xs font-semibold transition ${
                        toothView === 'primary'
                          ? 'bg-emerald-700 text-white'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      Primary / Child (51-85)
                    </button>
                  </div>
                </div>

                {/* Visual Chart Grid */}
                <div className="overflow-x-auto py-2">
                  {toothView === 'permanent' ? (
                    <div className="min-w-[600px] flex flex-col space-y-3 items-center">
                      {/* Upper Arch: Q1 (18-11) and Q2 (21-28) */}
                      <div className="flex items-center space-x-1">
                        <span className="text-[10px] font-mono text-slate-300 font-medium mr-2">Maxillary Right</span>
                        {PERMANENT_TEETH.slice(0, 8).map((t) => {
                          const hasFinding = caseSheet.teethEntries.some((e) => e.tooth === t);
                          return (
                            <button
                              key={t}
                              type="button"
                              id={`tooth-btn-${t}`}
                              disabled={visit.status !== 'IN_CONSULTATION'}
                              onClick={() => setSelectedToothForModal(t)}
                              className={`w-9 h-11 rounded flex flex-col items-center justify-center font-mono text-xs font-bold transition border ${
                                hasFinding
                                  ? 'bg-amber-600 text-white border-amber-400 shadow-md ring-2 ring-amber-400/50'
                                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white'
                              }`}
                              title={getToothLabel(t)}
                            >
                              <span>{t}</span>
                            </button>
                          );
                        })}
                        <div className="w-0.5 h-11 bg-slate-700 mx-1" />
                        {PERMANENT_TEETH.slice(8, 16).map((t) => {
                          const hasFinding = caseSheet.teethEntries.some((e) => e.tooth === t);
                          return (
                            <button
                              key={t}
                              type="button"
                              id={`tooth-btn-${t}`}
                              disabled={visit.status !== 'IN_CONSULTATION'}
                              onClick={() => setSelectedToothForModal(t)}
                              className={`w-9 h-11 rounded flex flex-col items-center justify-center font-mono text-xs font-bold transition border ${
                                hasFinding
                                  ? 'bg-amber-600 text-white border-amber-400 shadow-md ring-2 ring-amber-400/50'
                                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white'
                              }`}
                              title={getToothLabel(t)}
                            >
                              <span>{t}</span>
                            </button>
                          );
                        })}
                        <span className="text-[10px] font-mono text-slate-300 font-medium ml-2">Maxillary Left</span>
                      </div>

                      {/* Lower Arch: Q4 (48-41) and Q3 (31-38) */}
                      <div className="flex items-center space-x-1">
                        <span className="text-[10px] font-mono text-slate-300 font-medium mr-2">Mandibular Right</span>
                        {PERMANENT_TEETH.slice(16, 24).map((t) => {
                          const hasFinding = caseSheet.teethEntries.some((e) => e.tooth === t);
                          return (
                            <button
                              key={t}
                              type="button"
                              id={`tooth-btn-${t}`}
                              disabled={visit.status !== 'IN_CONSULTATION'}
                              onClick={() => setSelectedToothForModal(t)}
                              className={`w-9 h-11 rounded flex flex-col items-center justify-center font-mono text-xs font-bold transition border ${
                                hasFinding
                                  ? 'bg-amber-600 text-white border-amber-400 shadow-md ring-2 ring-amber-400/50'
                                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white'
                              }`}
                              title={getToothLabel(t)}
                            >
                              <span>{t}</span>
                            </button>
                          );
                        })}
                        <div className="w-0.5 h-11 bg-slate-700 mx-1" />
                        {PERMANENT_TEETH.slice(24, 32).map((t) => {
                          const hasFinding = caseSheet.teethEntries.some((e) => e.tooth === t);
                          return (
                            <button
                              key={t}
                              type="button"
                              id={`tooth-btn-${t}`}
                              disabled={visit.status !== 'IN_CONSULTATION'}
                              onClick={() => setSelectedToothForModal(t)}
                              className={`w-9 h-11 rounded flex flex-col items-center justify-center font-mono text-xs font-bold transition border ${
                                hasFinding
                                  ? 'bg-amber-600 text-white border-amber-400 shadow-md ring-2 ring-amber-400/50'
                                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white'
                              }`}
                              title={getToothLabel(t)}
                            >
                              <span>{t}</span>
                            </button>
                          );
                        })}
                        <span className="text-[10px] font-mono text-slate-300 font-medium ml-2">Mandibular Left</span>
                      </div>
                    </div>
                  ) : (
                    /* Primary Arch */
                    <div className="min-w-[450px] flex flex-col space-y-3 items-center">
                      <div className="flex items-center space-x-1">
                        <span className="text-[10px] font-mono text-slate-300 font-medium mr-2">Deciduous Upper Right</span>
                        {PRIMARY_TEETH.slice(0, 5).map((t) => {
                          const hasFinding = caseSheet.teethEntries.some((e) => e.tooth === t);
                          return (
                            <button
                              key={t}
                              type="button"
                              id={`tooth-btn-${t}`}
                              disabled={visit.status !== 'IN_CONSULTATION'}
                              onClick={() => setSelectedToothForModal(t)}
                              className={`w-9 h-11 rounded flex flex-col items-center justify-center font-mono text-xs font-bold transition border ${
                                hasFinding
                                  ? 'bg-amber-600 text-white border-amber-400 shadow-md ring-2 ring-amber-400/50'
                                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white'
                              }`}
                              title={getToothLabel(t)}
                            >
                              <span>{t}</span>
                            </button>
                          );
                        })}
                        <div className="w-0.5 h-11 bg-slate-700 mx-1" />
                        {PRIMARY_TEETH.slice(5, 10).map((t) => {
                          const hasFinding = caseSheet.teethEntries.some((e) => e.tooth === t);
                          return (
                            <button
                              key={t}
                              type="button"
                              id={`tooth-btn-${t}`}
                              disabled={visit.status !== 'IN_CONSULTATION'}
                              onClick={() => setSelectedToothForModal(t)}
                              className={`w-9 h-11 rounded flex flex-col items-center justify-center font-mono text-xs font-bold transition border ${
                                hasFinding
                                  ? 'bg-amber-600 text-white border-amber-400 shadow-md ring-2 ring-amber-400/50'
                                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white'
                              }`}
                              title={getToothLabel(t)}
                            >
                              <span>{t}</span>
                            </button>
                          );
                        })}
                        <span className="text-[10px] font-mono text-slate-300 font-medium ml-2">Deciduous Upper Left</span>
                      </div>

                      <div className="flex items-center space-x-1">
                        <span className="text-[10px] font-mono text-slate-300 font-medium mr-2">Deciduous Lower Right</span>
                        {PRIMARY_TEETH.slice(10, 15).map((t) => {
                          const hasFinding = caseSheet.teethEntries.some((e) => e.tooth === t);
                          return (
                            <button
                              key={t}
                              type="button"
                              id={`tooth-btn-${t}`}
                              disabled={visit.status !== 'IN_CONSULTATION'}
                              onClick={() => setSelectedToothForModal(t)}
                              className={`w-9 h-11 rounded flex flex-col items-center justify-center font-mono text-xs font-bold transition border ${
                                hasFinding
                                  ? 'bg-amber-600 text-white border-amber-400 shadow-md ring-2 ring-amber-400/50'
                                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white'
                              }`}
                              title={getToothLabel(t)}
                            >
                              <span>{t}</span>
                            </button>
                          );
                        })}
                        <div className="w-0.5 h-11 bg-slate-700 mx-1" />
                        {PRIMARY_TEETH.slice(15, 20).map((t) => {
                          const hasFinding = caseSheet.teethEntries.some((e) => e.tooth === t);
                          return (
                            <button
                              key={t}
                              type="button"
                              id={`tooth-btn-${t}`}
                              disabled={visit.status !== 'IN_CONSULTATION'}
                              onClick={() => setSelectedToothForModal(t)}
                              className={`w-9 h-11 rounded flex flex-col items-center justify-center font-mono text-xs font-bold transition border ${
                                hasFinding
                                  ? 'bg-amber-600 text-white border-amber-400 shadow-md ring-2 ring-amber-400/50'
                                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white'
                              }`}
                              title={getToothLabel(t)}
                            >
                              <span>{t}</span>
                            </button>
                          );
                        })}
                        <span className="text-[10px] font-mono text-slate-300 font-medium ml-2">Deciduous Lower Left</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Recorded Teeth Findings Table */}
                {caseSheet.teethEntries.length > 0 && (
                  <div className="mt-4 border-t border-slate-800 pt-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                      Recorded Teeth Findings ({caseSheet.teethEntries.length})
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left text-slate-300">
                        <thead className="bg-slate-800/80 text-slate-400 uppercase font-mono">
                          <tr>
                            <th className="p-2">Tooth #</th>
                            <th className="p-2">Condition / Procedure</th>
                            <th className="p-2">Notes</th>
                            <th className="p-2 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {caseSheet.teethEntries.map((te) => (
                            <tr key={te.tooth} id={`tooth-finding-row-${te.tooth}`} className="hover:bg-slate-800/40">
                              <td className="p-2 font-mono font-bold text-amber-400">
                                #{te.tooth} ({getToothLabel(te.tooth)})
                              </td>
                              <td className="p-2 font-semibold text-slate-200">{te.condition}</td>
                              <td className="p-2 text-slate-400">{te.notes || '—'}</td>
                              <td className="p-2 text-right">
                                {visit.status === 'IN_CONSULTATION' && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveToothFinding(te.tooth)}
                                    className="text-rose-400 hover:text-rose-300 font-semibold"
                                  >
                                    ✕ Remove
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'prescription' && (
            <div className="space-y-6">
              {/* If Prescription is ISSUED or VOID */}
              {prescription && (prescription.status === 'ISSUED' || prescription.status === 'VOID') ? (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
                    <div>
                      <div className="flex items-center space-x-3">
                        <h2 className="text-xl font-bold text-white font-mono">{prescription.rxNumber}</h2>
                        {prescription.status === 'ISSUED' && (
                          <span className="px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-700/60 text-xs font-bold">
                            ✓ ISSUED (Immutable)
                          </span>
                        )}
                        {prescription.status === 'VOID' && (
                          <span className="px-2.5 py-0.5 rounded-full bg-rose-950 text-rose-400 border border-rose-700/60 text-xs font-bold">
                            ✕ VOID ({prescription.voidReason})
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Printed {prescription.printCount || 0} times
                      </p>
                    </div>

                    <div className="flex items-center space-x-3">
                      <Link
                        href={`/print/prescription/${prescription._id}`}
                        target="_blank"
                        id="btn-print-rx"
                        className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold shadow transition focus:outline-none focus:ring-2 focus:ring-blue-400"
                      >
                        🖨️ Print Prescription
                      </Link>

                      {prescription.status === 'ISSUED' && (
                        <button
                          type="button"
                          id="btn-correct-rx"
                          onClick={() => {
                            setIsCorrecting(true);
                            setShowVoidModal(true);
                          }}
                          className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold shadow transition"
                        >
                          ✏️ Correct Prescription
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Frozen Items Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left text-slate-300">
                      <thead className="bg-slate-800 text-slate-400 uppercase font-mono">
                        <tr>
                          <th className="p-2.5">#</th>
                          <th className="p-2.5">Medicine</th>
                          <th className="p-2.5">Dose</th>
                          <th className="p-2.5">Frequency</th>
                          <th className="p-2.5">Duration</th>
                          <th className="p-2.5">Instructions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {prescription.items.map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-800/40">
                            <td className="p-2.5 font-mono text-slate-400">{idx + 1}</td>
                            <td className="p-2.5 font-bold text-slate-100">
                              {item.name} <span className="text-slate-400 font-normal">({item.form}, {item.strength})</span>
                            </td>
                            <td className="p-2.5">{item.dose || '—'}</td>
                            <td className="p-2.5 font-semibold text-emerald-400">{item.frequency}</td>
                            <td className="p-2.5">{item.duration}</td>
                            <td className="p-2.5 text-slate-400">{item.instruction || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs border-t border-slate-800 pt-4">
                    <div>
                      <span className="font-semibold text-slate-400 block mb-1">Advice:</span>
                      <p className="text-slate-200">{prescription.advice || 'None'}</p>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-400 block mb-1">Follow-up:</span>
                      <p className="text-slate-200">{prescription.followUpDate || 'None'}</p>
                    </div>
                  </div>
                </div>
              ) : (
                /* Editable Prescription Draft */
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
                    <div>
                      <h2 className="text-lg font-bold text-white">Prescription Editor (Draft)</h2>
                      <p className="text-xs text-slate-400">
                        Zero automated suggestions. Doctor decides every medicine, dose, and frequency.
                      </p>
                    </div>

                    <div className="flex items-center space-x-3">
                      {/* Prescription Templates Dropdown */}
                      <select
                        aria-label="Select prescription template"
                        className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                        onChange={(e) => {
                          if (e.target.value) handleApplySet(e.target.value);
                          e.target.value = '';
                        }}
                      >
                        <option value="">📂 Apply Template...</option>
                        {prescriptionSets.map((s) => (
                          <option key={s._id} value={s._id}>
                            {s.name} ({s.items.length} meds)
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={() => setShowSaveSetModal(true)}
                        disabled={!prescription || prescription.items.length === 0}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition"
                      >
                        💾 Save As Template
                      </button>

                      <button
                        type="button"
                        id="btn-save-rx-draft"
                        onClick={handleSavePrescriptionDraft}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-600 transition"
                      >
                        Save Draft
                      </button>

                      <button
                        type="button"
                        id="btn-issue-rx"
                        onClick={handleIssuePrescription}
                        className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow transition"
                      >
                        ⚡ Issue & Lock Prescription
                      </button>
                    </div>
                  </div>

                  {/* Medicine Search Combobox */}
                  <div className="relative">
                    <label htmlFor="input-med-search" className="block text-xs font-medium text-slate-300 mb-1">
                      Search & Add Medicine (Generic or Brand Name)
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        id="input-med-search"
                        value={medicineQuery}
                        onChange={(e) => {
                          setMedicineQuery(e.target.value);
                          setShowMedDropdown(true);
                        }}
                        onFocus={() => setShowMedDropdown(true)}
                        placeholder="Type to search formulary / sample medicines (e.g. Amoxicillin, Paracetamol)..."
                        className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 pr-10"
                      />
                      {isSearchingMeds && (
                        <div className="absolute right-3 top-2.5 text-xs text-slate-400">
                          Searching...
                        </div>
                      )}
                    </div>

                    {/* Combobox Dropdown Results */}
                    {showMedDropdown && (
                      <div className="absolute z-30 left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl max-h-72 overflow-y-auto divide-y divide-slate-750">
                        {medicineResults.length === 0 ? (
                          <div className="p-4 text-center text-xs text-slate-400">
                            No matching medicines found.{' '}
                            <button
                              type="button"
                              onClick={() => {
                                setShowMedDropdown(false);
                                setCustomGenName(medicineQuery);
                                setShowCustomMedModal(true);
                              }}
                              className="text-blue-400 underline font-semibold ml-1"
                            >
                              + Add &quot;{medicineQuery}&quot; as Custom Medicine
                            </button>
                          </div>
                        ) : (
                          medicineResults.map((med) => (
                            <div
                              key={med._id}
                              onClick={() => handleAddMedicineLine(med)}
                              className="px-4 py-2.5 hover:bg-slate-700/80 cursor-pointer flex items-center justify-between transition group"
                            >
                              <div>
                                <div className="flex items-center space-x-2">
                                  <span className="font-bold text-sm text-white group-hover:text-blue-300">
                                    {med.brandName ? `${med.brandName} (${med.genericName})` : med.genericName}
                                  </span>
                                  <span className="text-xs text-slate-400 font-mono">
                                    {med.form} • {med.strength}
                                  </span>
                                  {med.verified ? (
                                    <span className="px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-700 text-[10px] font-semibold">
                                      ✓ Verified
                                    </span>
                                  ) : (
                                    <span className="px-1.5 py-0.2 rounded bg-slate-900 text-slate-400 border border-slate-700 text-[10px]">
                                      Sample
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center space-x-2">
                                <button
                                  type="button"
                                  onClick={(e) => handleToggleFavorite(e, med._id)}
                                  className="p-1 text-slate-400 hover:text-amber-400 transition"
                                  title={med.isFavorite ? 'Remove from favorites' : 'Star as favorite'}
                                >
                                  {med.isFavorite ? '★' : '☆'}
                                </button>
                                <span className="text-xs text-blue-400 font-semibold group-hover:underline">
                                  + Add
                                </span>
                              </div>
                            </div>
                          ))
                        )}
                        <div className="p-2.5 bg-slate-850 border-t border-slate-700 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setShowMedDropdown(false);
                              setShowCustomMedModal(true);
                            }}
                            className="text-xs text-blue-400 hover:text-blue-300 font-semibold"
                          >
                            + Add New Custom Medicine
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Multi-Line Medicine Items Table */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Prescribed Medicines ({prescription?.items?.length || 0})
                    </h3>

                    {(!prescription || prescription.items.length === 0) ? (
                      <div className="p-8 border border-dashed border-slate-700 rounded-xl text-center text-xs text-slate-400">
                        No medicines added yet. Use the search bar above or apply a template.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {prescription.items.map((line, idx) => (
                          <div
                            key={idx}
                            id={`rx-line-${idx}`}
                            className="bg-slate-850 p-4 rounded-xl border border-slate-750 space-y-3"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-sm text-slate-100 flex items-center space-x-2">
                                <span className="font-mono text-slate-400">#{idx + 1}</span>
                                <span>{line.name}</span>
                                <span className="text-xs text-slate-400 font-normal">
                                  ({line.form}, {line.strength})
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRemoveMedicineLine(idx)}
                                className="text-xs text-rose-400 hover:text-rose-300 font-semibold"
                              >
                                ✕ Remove
                              </button>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                              <div>
                                <label className="block text-slate-400 mb-1">Dose</label>
                                <input
                                  type="text"
                                  id={`rx-dose-${idx}`}
                                  value={line.dose}
                                  onChange={(e) => handleUpdateMedicineLine(idx, 'dose', e.target.value)}
                                  placeholder="e.g. 1 tab, 500mg"
                                  className="w-full bg-slate-800 border border-slate-700 rounded p-1.5 text-slate-200 focus:outline-none focus:border-blue-500"
                                />
                                <div className="flex gap-1 mt-1">
                                  {['1 tab', '1 cap', '1 tsp'].map((chip) => (
                                    <button
                                      key={chip}
                                      type="button"
                                      onClick={() => handleUpdateMedicineLine(idx, 'dose', chip)}
                                      className="text-[10px] bg-slate-800 hover:bg-slate-700 px-1 py-0.5 rounded text-slate-400"
                                    >
                                      {chip}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div>
                                <label className="block text-slate-400 mb-1">Frequency *</label>
                                <input
                                  type="text"
                                  id={`rx-freq-${idx}`}
                                  value={line.frequency}
                                  onChange={(e) => handleUpdateMedicineLine(idx, 'frequency', e.target.value)}
                                  placeholder="e.g. 1-0-1, 1-1-1"
                                  className="w-full bg-slate-800 border border-slate-700 rounded p-1.5 text-slate-200 focus:outline-none focus:border-blue-500"
                                />
                                <div className="flex gap-1 mt-1">
                                  {['1-0-1', '1-1-1', '1-0-0', 'SOS'].map((chip) => (
                                    <button
                                      key={chip}
                                      type="button"
                                      onClick={() => handleUpdateMedicineLine(idx, 'frequency', chip)}
                                      className="text-[10px] bg-slate-800 hover:bg-slate-700 px-1 py-0.5 rounded text-slate-400"
                                    >
                                      {chip}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div>
                                <label className="block text-slate-400 mb-1">Duration *</label>
                                <input
                                  type="text"
                                  id={`rx-duration-${idx}`}
                                  value={line.duration}
                                  onChange={(e) => handleUpdateMedicineLine(idx, 'duration', e.target.value)}
                                  placeholder="e.g. 3 days, 5 days"
                                  className="w-full bg-slate-800 border border-slate-700 rounded p-1.5 text-slate-200 focus:outline-none focus:border-blue-500"
                                />
                                <div className="flex gap-1 mt-1">
                                  {['3 days', '5 days', '7 days'].map((chip) => (
                                    <button
                                      key={chip}
                                      type="button"
                                      onClick={() => handleUpdateMedicineLine(idx, 'duration', chip)}
                                      className="text-[10px] bg-slate-800 hover:bg-slate-700 px-1 py-0.5 rounded text-slate-400"
                                    >
                                      {chip}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div>
                                <label className="block text-slate-400 mb-1">Instructions</label>
                                <input
                                  type="text"
                                  id={`rx-instruction-${idx}`}
                                  value={line.instruction}
                                  onChange={(e) => handleUpdateMedicineLine(idx, 'instruction', e.target.value)}
                                  placeholder="e.g. After food"
                                  className="w-full bg-slate-800 border border-slate-700 rounded p-1.5 text-slate-200 focus:outline-none focus:border-blue-500"
                                />
                                <div className="flex gap-1 mt-1">
                                  {['After food', 'Before food', 'Gargle'].map((chip) => (
                                    <button
                                      key={chip}
                                      type="button"
                                      onClick={() => handleUpdateMedicineLine(idx, 'instruction', chip)}
                                      className="text-[10px] bg-slate-800 hover:bg-slate-700 px-1 py-0.5 rounded text-slate-400"
                                    >
                                      {chip}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Advice & Follow-Up Date */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs border-t border-slate-800 pt-4">
                    <div className="md:col-span-2">
                      <label htmlFor="rx-advice" className="block text-slate-300 font-medium mb-1">
                        General Advice / Special Instructions
                      </label>
                      <textarea
                        id="rx-advice"
                        rows={2}
                        value={prescription?.advice || ''}
                        onChange={(e) => setPrescription((prev) => ({ ...prev!, advice: e.target.value }))}
                        placeholder="Avoid hot/spicy food for 24h; warm salt water rinses starting tomorrow..."
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label htmlFor="rx-follow-up" className="block text-slate-300 font-medium mb-1">
                        Follow-up Date / Advice
                      </label>
                      <input
                        type="text"
                        id="rx-follow-up"
                        value={prescription?.followUpDate || ''}
                        onChange={(e) => setPrescription((prev) => ({ ...prev!, followUpDate: e.target.value }))}
                        placeholder="e.g. After 5 days for suture removal"
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      {/* Tooth Detail Modal */}
      {selectedToothForModal !== null && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-base font-bold text-white">
                Record Finding for Tooth #{selectedToothForModal}
              </h3>
              <button
                type="button"
                onClick={() => setSelectedToothForModal(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 font-mono">{getToothLabel(selectedToothForModal)}</p>

            <div>
              <label htmlFor="modal-tooth-condition" className="block text-xs font-semibold text-slate-300 mb-1">
                Condition or Procedure
              </label>
              <select
                id="modal-tooth-condition"
                autoFocus
                value={newToothCondition}
                onChange={(e) => setNewToothCondition(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
              >
                {STANDARD_DENTAL_CONDITIONS.map((cond) => (
                  <option key={cond} value={cond}>
                    {cond}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="modal-tooth-notes" className="block text-xs font-semibold text-slate-300 mb-1">
                Clinical Notes / Findings (Optional)
              </label>
              <input
                type="text"
                id="modal-tooth-notes"
                value={newToothNotes}
                onChange={(e) => setNewToothNotes(e.target.value)}
                placeholder="e.g. Mesial decay, pain on percussion"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setSelectedToothForModal(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-save-tooth-finding"
                onClick={handleAddToothFinding}
                className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-xs font-bold text-white shadow"
              >
                Save Tooth Finding
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Medicine Modal */}
      {showCustomMedModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateCustomMedicine}
            className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-base font-bold text-white">+ Add Custom Medicine</h3>
              <button
                type="button"
                onClick={() => setShowCustomMedModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Owned by this clinic, visible under &quot;My medicines&quot;, and permanently searchable.
            </p>

            <div>
              <label htmlFor="custom-gen-name" className="block text-xs font-semibold text-slate-300 mb-1">
                Generic Name *
              </label>
              <input
                type="text"
                id="custom-gen-name"
                required
                value={customGenName}
                onChange={(e) => setCustomGenName(e.target.value)}
                placeholder="e.g. Amoxicillin Clavulanic Acid"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100"
              />
            </div>

            <div>
              <label htmlFor="custom-brand-name" className="block text-xs font-semibold text-slate-300 mb-1">
                Brand Name (Optional)
              </label>
              <input
                type="text"
                id="custom-brand-name"
                value={customBrandName}
                onChange={(e) => setCustomBrandName(e.target.value)}
                placeholder="e.g. Augmentin 625"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="custom-form" className="block text-xs font-semibold text-slate-300 mb-1">
                  Form *
                </label>
                <select
                  id="custom-form"
                  value={customForm}
                  onChange={(e) => setCustomForm(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100"
                >
                  <option value="tablet">tablet</option>
                  <option value="capsule">capsule</option>
                  <option value="gel">gel</option>
                  <option value="ointment">ointment</option>
                  <option value="mouthwash">mouthwash</option>
                  <option value="drops">drops</option>
                  <option value="injection">injection</option>
                  <option value="other">other</option>
                </select>
              </div>

              <div>
                <label htmlFor="custom-strength" className="block text-xs font-semibold text-slate-300 mb-1">
                  Strength *
                </label>
                <input
                  type="text"
                  id="custom-strength"
                  required
                  value={customStrength}
                  onChange={(e) => setCustomStrength(e.target.value)}
                  placeholder="e.g. 625 mg, 0.2%"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCustomMedModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                id="btn-submit-custom-med"
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white shadow"
              >
                Save & Add
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Void / Correct Modal */}
      {showVoidModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-base font-bold text-white">
                {isCorrecting ? 'Correct Prescription (Void & Re-issue)' : 'Void Issued Prescription'}
              </h3>
              <button
                type="button"
                onClick={() => setShowVoidModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Prescriptions cannot be silently overwritten or deleted. Voiding will permanently stamp this record
              with your reason and create an audit log.
            </p>

            <div>
              <label htmlFor="void-reason" className="block text-xs font-semibold text-slate-300 mb-1">
                Mandatory Void Reason *
              </label>
              <textarea
                id="void-reason"
                required
                rows={3}
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="e.g. Corrected dosage of antibiotic due to patient weight / sensitivity"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100"
              />
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowVoidModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-void"
                onClick={handleVoidOrCorrect}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-bold text-white shadow"
              >
                Confirm {isCorrecting ? 'Correction' : 'Void'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Template Modal */}
      {showSaveSetModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveAsSet}
            className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-base font-bold text-white">Save Current Medicines as Template</h3>
              <button
                type="button"
                onClick={() => setShowSaveSetModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div>
              <label htmlFor="new-set-name" className="block text-xs font-semibold text-slate-300 mb-1">
                Template Name *
              </label>
              <input
                type="text"
                id="new-set-name"
                required
                value={newSetName}
                onChange={(e) => setNewSetName(e.target.value)}
                placeholder="e.g. After extraction, RCT Stage 1"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100"
              />
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowSaveSetModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                id="btn-submit-save-set"
                className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-xs font-bold text-white shadow"
              >
                Save Template
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
