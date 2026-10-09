'use client';

import { use } from 'react';
import { AssetLabel } from '@/components/assets/AssetLabel';

export default function EquipmentLabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <AssetLabel type="equipment" id={id} />;
}
