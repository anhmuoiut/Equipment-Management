'use client';

import { use } from 'react';
import { AssetLabel } from '@/components/assets/AssetLabel';

export default function CalibrationLabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <AssetLabel type="sub_equipment" id={id} />;
}
