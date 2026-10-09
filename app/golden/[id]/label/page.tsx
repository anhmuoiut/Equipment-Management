'use client';

import { use } from 'react';
import { AssetLabel } from '@/components/assets/AssetLabel';

export default function GoldenLabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <AssetLabel type="golden_board" id={id} />;
}
