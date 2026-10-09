'use client';

import { Suspense } from 'react';
import { OverviewPage } from '@/components/overview/OverviewPage';

export default function OverviewRoute() {
  return <Suspense><OverviewPage /></Suspense>;
}
