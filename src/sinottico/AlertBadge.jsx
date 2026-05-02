// Pill colorata per la severità di un alert.
// Le classi CSS corrispondenti sono in SinotticoOverview.css.
import React from 'react';

const SEVERITA_VALIDE = ['CRITICA', 'ALTA', 'MEDIA'];

export default function AlertBadge({ severita }) {
  if (!severita || !SEVERITA_VALIDE.includes(severita)) return null;

  return (
    <span className={`alert-badge badge-${severita.toLowerCase()}`}>
      {severita}
    </span>
  );
}
