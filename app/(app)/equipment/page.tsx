'use client';

import { Suspense } from 'react';
import { EquipmentWorkspace } from '@/components/equipment/EquipmentWorkspace';

export default function EquipmentPage() {
  return <Suspense><EquipmentWorkspace /></Suspense>;
}
