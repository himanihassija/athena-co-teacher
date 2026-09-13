/**
 * Catch-up Sessions from Real Availability.
 *
 * Provides real-time slot scheduling for absent and struggling students
 * to book 1:1 catch-up tutoring sessions with teachers and Athena.
 */

import { randomUUID } from 'node:crypto';
import type {
  CatchupAvailabilitySlot,
  CatchupBookingRequest,
} from '@echosphere/shared-types';
import type { ClassroomSession } from '../state/sessionRegistry.js';
import { publish } from '../state/eventBus.js';

export function getCatchupSlots(session: ClassroomSession): CatchupAvailabilitySlot[] {
  if (!session.catchupSlots || session.catchupSlots.length === 0) {
    session.catchupSlots = generateUpcomingSlots();
  }
  return session.catchupSlots;
}

function generateUpcomingSlots(): CatchupAvailabilitySlot[] {
  const slots: CatchupAvailabilitySlot[] = [];
  const now = new Date();

  // Generate slots over next 3 weekdays
  for (let d = 1; d <= 3; d++) {
    const targetDate = new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
    const dateStr = targetDate.toISOString().split('T')[0] ?? '';

    const times = [
      { start: '15:30', end: '16:00' },
      { start: '16:00', end: '16:30' },
      { start: '17:00', end: '17:30' },
    ];

    for (const time of times) {
      slots.push({
        slotId: `slot-${randomUUID().slice(0, 8)}`,
        date: dateStr,
        startTime: time.start,
        endTime: time.end,
        teacherName: 'Ms. Henderson & Athena AI',
        isBooked: false,
      });
    }
  }

  return slots;
}

export function bookCatchupSlot(
  session: ClassroomSession,
  booking: CatchupBookingRequest,
): CatchupAvailabilitySlot {
  const slots = getCatchupSlots(session);
  const slot = slots.find((s) => s.slotId === booking.slotId);

  if (!slot) {
    throw new Error('Selected availability slot not found.');
  }

  if (slot.isBooked) {
    throw new Error('This slot has already been booked by another student.');
  }

  slot.isBooked = true;
  slot.bookedByStudentId = booking.studentId;
  slot.bookedByStudentName = booking.studentName;
  slot.topic = booking.topic;

  publish(session.sessionId, {
    kind: 'echosphere:catchup-slots-updated',
    slots,
  });

  return slot;
}

export function cancelCatchupSlot(
  session: ClassroomSession,
  slotId: string,
): CatchupAvailabilitySlot {
  const slots = getCatchupSlots(session);
  const slot = slots.find((s) => s.slotId === slotId);

  if (!slot) {
    throw new Error('Slot not found.');
  }

  slot.isBooked = false;
  slot.bookedByStudentId = undefined;
  slot.bookedByStudentName = undefined;
  slot.topic = undefined;

  publish(session.sessionId, {
    kind: 'echosphere:catchup-slots-updated',
    slots,
  });

  return slot;
}

export function addCustomSlot(
  session: ClassroomSession,
  slotData: { date: string; startTime: string; endTime: string; teacherName?: string },
): CatchupAvailabilitySlot {
  const slots = getCatchupSlots(session);
  const newSlot: CatchupAvailabilitySlot = {
    slotId: `slot-${randomUUID().slice(0, 8)}`,
    date: slotData.date,
    startTime: slotData.startTime,
    endTime: slotData.endTime,
    teacherName: slotData.teacherName || 'Ms. Henderson & Athena AI',
    isBooked: false,
  };

  slots.push(newSlot);

  publish(session.sessionId, {
    kind: 'echosphere:catchup-slots-updated',
    slots,
  });

  return newSlot;
}

