import { useState, useMemo } from "react";
import { Activity, Search, ArrowUp, ArrowDown, Radio, Headphones } from "lucide-react";
import { clsx } from "clsx";
import type { EventsData, StormEvent } from "@/lib/queries";

interface Props {
  data: EventsData | undefined;
  isLoading: boolean;
}

const EVENT_COLORS: Record<string, string> = {
  "user": "bg-blue-50 text-blue-700 border-blue-200",
  "contact": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "deal": "bg-amber-50 text-amber-700 border-amber-200",
  "ticket": "bg-purple-50 text-purple-700 border-purple-200",
  "payment": "bg-green-50 text-green-700 border-green-200",
  "subscription": "bg-cyan-50 text-cyan-700 border-cyan-200",
  "plugin": "bg-gray-50 text-gray-600 border-gray-200",
};

function eventColor(name: string): string {
  const prefix = name.split(".")[0] ?? "";
  return EVENT_COLORS[prefix] ?? "bg-gray-50 text-gray-600 border-gray-200";
}

function formatTime(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return timestamp;
  }
}

export function EventLogViewer({ data, isLoading }: Props) {
  const [search, setSearch] = useState("");
  const [sortAsc, setSortAsc] = useState(false);

  const history = data?.history ?? [];
  const emitters = data?.emitters ?? {};
  const listeners = data?.listeners ?? {};

  const filtered = useMemo(() => {
    let events = [...history];
    if (search) {
      const q = search.toLowerCase();
      events = events.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.source.toLowerCase().includes(q) ||
          JSON.stringify(e.payload).toLowerCase().includes(q),
      );
    }
    if (sortAsc) events.reverse();
    return events;
  }, [history, search, sortAsc]);

  // Count unique event types across emitters/listeners
  const allEventNames = useMemo(() => {
    const names = new Set<string>();
    for (const events of Object.values(emitters)) events.forEach((e) => names.add(e));
    for (const events of Object.values(listeners)) events.forEach((e) => names.add(e));
    return names;
  }, [emitters, listeners]);

  return (
    <div className="space-y-6">
      {/* Emitters / Listeners map */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EventMap
          title="Emitters"
          subtitle="Plugins qui émettent des événements"
          icon={Radio}
          map={emitters}
          color="text-storm-600"
        />
        <EventMap
          title="Listeners"
          subtitle="Plugins qui écoutent des événements"
          icon={Headphones}
          map={listeners}
          color="text-purple-600"
        />
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span>{allEventNames.size} types d'événements</span>
        <span>{Object.keys(emitters).length} emitters</span>
        <span>{Object.keys(listeners).length} listeners</span>
        <span>{history.length} événements en historique</span>
      </div>

      {/* Event log */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-storm-600" />
            <h3 className="text-sm font-semibold text-gray-800">Historique</h3>
            {!isLoading && (
              <span className="text-[10px] text-gray-400">
                (rafraîchissement auto 5s)
              </span>
            )}
          </div>
          <button
            onClick={() => setSortAsc(!sortAsc)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
          >
            {sortAsc ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {sortAsc ? "Plus ancien" : "Plus récent"}
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Filtrer par événement, source ou payload..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-storm-500/20 focus:border-storm-300"
          />
        </div>

        {/* Events list */}
        {isLoading ? (
          <div className="text-sm text-gray-400 text-center py-8">Chargement...</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
            {search ? "Aucun événement ne correspond." : "Aucun événement enregistré."}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
            {filtered.map((event, i) => (
              <EventRow key={`${event.name}-${event.timestamp}-${i}`} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function EventMap({
  title,
  subtitle,
  icon: Icon,
  map,
  color,
}: {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  map: Record<string, string[]>;
  color: string;
}) {
  const entries = Object.entries(map);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={14} className={color} />
        <div>
          <p className="text-xs font-semibold text-gray-800">{title}</p>
          <p className="text-[10px] text-gray-400">{subtitle}</p>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-gray-400 italic">Aucun</p>
      ) : (
        <div className="space-y-2">
          {entries.map(([pluginId, events]) => (
            <div key={pluginId}>
              <p className="text-[10px] font-medium text-gray-600 font-mono mb-1">
                {pluginId.replace("@stormstack/", "")}
              </p>
              <div className="flex flex-wrap gap-1">
                {events.map((e) => (
                  <span
                    key={e}
                    className={clsx(
                      "text-[10px] px-1.5 py-0.5 rounded border font-mono",
                      eventColor(e),
                    )}
                  >
                    {e}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: StormEvent }) {
  const [expanded, setExpanded] = useState(false);
  const payloadStr = JSON.stringify(event.payload, null, 2);
  const isLargePayload = payloadStr.length > 80;

  return (
    <div
      className="px-4 py-2.5 hover:bg-gray-50/50 cursor-pointer transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center gap-3">
        <span className="text-[10px] text-gray-400 font-mono w-16 shrink-0">
          {formatTime(event.timestamp)}
        </span>
        <span className={clsx("text-[10px] px-1.5 py-0.5 rounded border font-mono", eventColor(event.name))}>
          {event.name}
        </span>
        <span className="text-[10px] text-gray-400 font-mono">
          {event.source.replace("@stormstack/", "")}
        </span>
        {!expanded && !isLargePayload && (
          <span className="text-[10px] text-gray-400 font-mono truncate ml-auto max-w-[200px]">
            {payloadStr.replace(/\n/g, " ")}
          </span>
        )}
      </div>
      {expanded && (
        <pre className="mt-2 p-2 bg-gray-50 rounded-lg text-[10px] text-gray-600 font-mono overflow-x-auto max-h-40">
          {payloadStr}
        </pre>
      )}
    </div>
  );
}
