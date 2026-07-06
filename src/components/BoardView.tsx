import React from 'react';
import Svg, { Circle, Line, G, Text as SvgText } from 'react-native-svg';

import { BoardLayout, CATEGORY_COLORS } from '../lib/boardLayout';
import {
  Position, CENTER, RING_SIZE, SPOKE_LEN,
  spokePos, ringPos, hubRingIndex, squareAt,
} from '../lib/board';

// ── Geometry ────────────────────────────────────────────────
const SIZE   = 360;
const CX     = SIZE / 2;
const CY     = SIZE / 2;
const R_RING = 150;          // outer ring radius
const R_MID  = 100;          // spoke mid square
const R_IN   = 55;           // spoke inner square
const R_SQ   = 15;           // regular square radius
const R_HUB  = 20;           // checkpoint (hub) radius
const R_PAWN = 7;

const ringAngle = (k: number) => (-90 + k * (360 / RING_SIZE)) * (Math.PI / 180);

function coordsFor(pos: Position): { x: number; y: number } {
  if (pos === CENTER) return { x: CX, y: CY };
  const [kind, a, b] = pos.split(':');
  if (kind === 'spoke') {
    const i = Number(a), j = Number(b);
    const ang = ringAngle(hubRingIndex(i));
    const r = j === 0 ? R_IN : R_MID;
    return { x: CX + r * Math.cos(ang), y: CY + r * Math.sin(ang) };
  }
  const k = Number(a);
  const ang = ringAngle(k);
  return { x: CX + R_RING * Math.cos(ang), y: CY + R_RING * Math.sin(ang) };
}

export interface PawnInfo {
  position: Position;
  color:    string;
  label:    string;   // initials shown on the pawn
}

interface Props {
  layout:      BoardLayout;
  pawns:       PawnInfo[];
  legalMoves?: Position[];                 // squares to highlight as tappable
  onSquarePress?: (pos: Position) => void;
}

export default function BoardView({ layout, pawns, legalMoves = [], onSquarePress }: Props) {
  const legal = new Set(legalMoves);

  // Build the list of every square position once.
  const positions: Position[] = [CENTER];
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < SPOKE_LEN; j++) positions.push(spokePos(i, j));
  }
  for (let k = 0; k < RING_SIZE; k++) positions.push(ringPos(k));

  // Group pawns sharing a square so we can fan them out.
  const pawnsByPos = pawns.reduce<Record<string, PawnInfo[]>>((acc, p) => {
    (acc[p.position] ??= []).push(p);
    return acc;
  }, {});

  return (
    <Svg viewBox={`0 0 ${SIZE} ${SIZE}`} width="100%" height="100%">
      {/* ── Connecting lines (drawn first, under squares) ── */}
      {/* spokes: center -> inner -> mid -> hub */}
      {Array.from({ length: 6 }, (_, i) => {
        const c   = coordsFor(CENTER);
        const in0 = coordsFor(spokePos(i, 0));
        const mid = coordsFor(spokePos(i, 1));
        const hub = coordsFor(ringPos(hubRingIndex(i)));
        return (
          <G key={`spoke-line-${i}`}>
            <Line x1={c.x}   y1={c.y}   x2={in0.x} y2={in0.y} stroke="#C8930A55" strokeWidth={3} />
            <Line x1={in0.x} y1={in0.y} x2={mid.x} y2={mid.y} stroke="#C8930A55" strokeWidth={3} />
            <Line x1={mid.x} y1={mid.y} x2={hub.x} y2={hub.y} stroke="#C8930A55" strokeWidth={3} />
          </G>
        );
      })}
      {/* ring cycle */}
      {Array.from({ length: RING_SIZE }, (_, k) => {
        const a = coordsFor(ringPos(k));
        const b = coordsFor(ringPos(k + 1));
        return <Line key={`ring-line-${k}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#C8930A55" strokeWidth={3} />;
      })}

      {/* ── Squares ── */}
      {positions.map(pos => {
        const { x, y } = coordsFor(pos);
        const sq = squareAt(layout, pos);
        const isLegal = legal.has(pos);

        let fill = '#5C3317';
        let r = R_SQ;
        if (sq.kind === 'start')       { fill = '#2C1810'; r = R_HUB; }
        else if (sq.kind === 'roll_again') { fill = '#C8930A'; }
        else { fill = CATEGORY_COLORS[sq.category]; if (sq.checkpoint) r = R_HUB; }

        const isCheckpoint = sq.kind === 'category' && sq.checkpoint;

        return (
          <G key={pos} onPress={onSquarePress ? () => onSquarePress(pos) : undefined}>
            {isLegal && <Circle cx={x} cy={y} r={r + 5} fill="none" stroke="#2a8a3e" strokeWidth={3} />}
            <Circle
              cx={x} cy={y} r={r}
              fill={fill}
              stroke={isCheckpoint ? '#F5DEB3' : '#fff8e8'}
              strokeWidth={isCheckpoint ? 3 : 1.5}
            />
            {sq.kind === 'roll_again' && (
              <SvgText x={x} y={y + 4} fontSize={12} fontWeight="bold" fill="#2C1810" textAnchor="middle">↻</SvgText>
            )}
            {sq.kind === 'start' && (
              <SvgText x={x} y={y + 4} fontSize={11} fontWeight="bold" fill="#F5DEB3" textAnchor="middle">START</SvgText>
            )}
          </G>
        );
      })}

      {/* ── Pawns (drawn last, on top) ── */}
      {Object.entries(pawnsByPos).flatMap(([pos, group]) => {
        const { x, y } = coordsFor(pos);
        return group.map((p, idx) => {
          // fan multiple pawns on one square apart horizontally
          const offset = group.length > 1 ? (idx - (group.length - 1) / 2) * (R_PAWN * 1.6) : 0;
          return (
            <G key={`pawn-${p.label}-${idx}`}>
              <Circle cx={x + offset} cy={y} r={R_PAWN + 1.5} fill="#fff8e8" />
              <Circle cx={x + offset} cy={y} r={R_PAWN} fill={p.color} />
              <SvgText x={x + offset} y={y + 3} fontSize={8} fontWeight="bold" fill="#fff" textAnchor="middle">
                {p.label}
              </SvgText>
            </G>
          );
        });
      })}
    </Svg>
  );
}
