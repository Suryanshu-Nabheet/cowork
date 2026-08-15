import {
  CRON_FREQS,
  type CronFreq,
  type CronPreset,
  type CronUnit,
  cronFromPreset,
  describeCronPreset,
} from "@cowork/core";
import { ClockIcon } from "../components/icons.js";

const UNITS: CronUnit[] = ["minutes", "hours", "days"];
const NUMBERS = [1, 2, 3, 5, 10, 15, 30, 45];
const TIMES = [
  "6:00 AM",
  "7:00 AM",
  "8:00 AM",
  "9:00 AM",
  "12:00 PM",
  "3:00 PM",
  "6:00 PM",
  "9:00 PM",
];

const TIMED: CronFreq[] = ["Every day", "Weekdays", "Every week", "Every month"];

export function RoutineSchedule({
  value,
  onChange,
}: {
  value: CronPreset;
  onChange: (next: CronPreset) => void;
}) {
  const { lead, detail } = describeCronPreset(value);
  const times = TIMES.includes(value.time) ? TIMES : [...TIMES, value.time];
  const numbers = NUMBERS.includes(value.n) ? NUMBERS : [...NUMBERS, value.n].sort((a, b) => a - b);

  function patch(partial: Partial<CronPreset>) {
    onChange({ ...value, ...partial });
  }

  return (
    <div className="mt-2 rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-3">
      <div className="flex items-center gap-2 px-0.5">
        <ClockIcon className="h-4 w-4 text-zinc-400 shrink-0" />
        <span className="text-xs font-medium text-zinc-200">{lead}</span>
        {detail ? <span className="flex-1 text-xs text-zinc-500">{detail}</span> : null}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-md bg-zinc-950 p-2 text-xs text-zinc-400 border border-zinc-800/60">
        <select
          className="rk-schedule-select rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none"
          value={value.freq}
          aria-label="How often"
          onChange={(event) => {
            const freq = event.target.value as CronFreq;
            if (freq === "Advanced") {
              patch({ freq, cron: cronFromPreset(value) });
              return;
            }
            patch({ freq });
          }}
        >
          {CRON_FREQS.map((freq) => (
            <option key={freq} value={freq}>
              {freq}
            </option>
          ))}
        </select>
        {value.freq === "Interval" ? (
          <>
            <span className="text-zinc-500">every</span>
            <select
              className="rk-schedule-select rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none"
              value={String(value.n)}
              aria-label="Interval amount"
              onChange={(event) => patch({ n: Number(event.target.value) })}
            >
              {numbers.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <select
              className="rk-schedule-select rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none"
              value={value.unit}
              aria-label="Interval unit"
              onChange={(event) => patch({ unit: event.target.value as CronUnit })}
            >
              {UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {TIMED.includes(value.freq) ? (
          <>
            <span className="text-zinc-500">at</span>
            <select
              className="rk-schedule-select rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none"
              value={value.time}
              aria-label="Time of day"
              onChange={(event) => patch({ time: event.target.value })}
            >
              {times.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {value.freq === "Advanced" ? (
          <input
            value={value.cron}
            placeholder="*/3 * * * *"
            aria-label="Cron expression"
            onChange={(event) => patch({ cron: event.target.value })}
            className="min-w-[120px] flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-200 outline-none"
          />
        ) : null}
      </div>
    </div>
  );
}
