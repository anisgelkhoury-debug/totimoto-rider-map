import { useEffect, useState, type CSSProperties } from "react"
import type { Firestore } from "firebase/firestore"
import {
  CONFIRMATION_COPY,
  canUserCastConfirmation,
  countConfirmations,
  formatConfirmationSummary,
  isReportOwnerForConfirmation,
  type ConfirmationStatus,
  type ConfirmationishReport,
} from "../../reportConfirmations/reportConfirmations"
import {
  freshnessLabelForState,
  resolveFreshnessState,
  resolveTrustState,
  trustLabelForState,
  trustStateColor,
} from "../../reportConfirmations/reportTrust"
import {
  loadReportConfirmations,
  upsertReportConfirmation,
  type LoadedConfirmation,
} from "../../reportConfirmations/firestoreConfirmations"

type ReportConfirmationPanelProps = {
  db: Firestore
  report: ConfirmationishReport & {
    id: string
    createdAt?: number
    expiry?: number
  }
  currentUid: string | null
  authReady: boolean
}

const btnBase: CSSProperties = {
  flex: 1,
  minHeight: 48,
  padding: "10px 8px",
  borderRadius: 14,
  border: "2px solid transparent",
  fontWeight: 800,
  fontSize: 15,
  fontFamily: "inherit",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
}

/**
 * Parent should mount only for confirmation-eligible reports and
 * remount via key={report.id} so local state resets without sync effect sets.
 */
export default function ReportConfirmationPanel({
  db,
  report,
  currentUid,
  authReady,
}: ReportConfirmationPanelProps) {
  const [docs, setDocs] = useState<LoadedConfirmation[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [myStatus, setMyStatus] = useState<ConfirmationStatus | null>(null)

  const isOwner = isReportOwnerForConfirmation(report, currentUid)
  const canVote = canUserCastConfirmation({ report, currentUid })

  useEffect(() => {
    let cancelled = false

    void loadReportConfirmations(db, report.id)
      .then((loaded) => {
        if (cancelled) return
        setDocs(loaded)
        const mine =
          currentUid != null
            ? loaded.find((d) => d.id === currentUid)
            : undefined
        setMyStatus(mine?.status ?? null)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setDocs([])
        setMyStatus(null)
        setErrorMessage(CONFIRMATION_COPY.reportMissing)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [db, report.id, currentUid])

  const counts = countConfirmations(docs)
  const trustState = resolveTrustState(counts)
  const trustLabel = trustLabelForState(trustState)
  const freshness = resolveFreshnessState({
    createdAt: report.createdAt,
    expiry: report.expiry,
  })
  const freshnessLabel = freshnessLabelForState(freshness)

  const castVote = async (status: ConfirmationStatus) => {
    if (!canVote || saving) return
    if (!authReady || !currentUid) {
      setErrorMessage(CONFIRMATION_COPY.authNotReady)
      return
    }

    setSaving(true)
    setErrorMessage(null)
    try {
      await upsertReportConfirmation({
        db,
        reportId: report.id,
        uid: currentUid,
        status,
      })
      const refreshed = await loadReportConfirmations(db, report.id)
      setDocs(refreshed)
      setMyStatus(status)
    } catch {
      setErrorMessage(CONFIRMATION_COPY.voteFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        marginTop: 12,
        textAlign: "center",
        direction: "rtl",
      }}
    >
      {/* Compact trust + freshness block */}
      <div style={{ marginBottom: 10 }}>
        <div
          style={{
            color: trustStateColor(trustState),
            fontSize: 13,
            fontWeight: 800,
            lineHeight: 1.35,
          }}
        >
          {trustLabel}
        </div>
        {!loading && counts.total > 0 ? (
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              fontWeight: 700,
              color: "#475569",
            }}
          >
            {formatConfirmationSummary(counts)}
          </div>
        ) : null}
        {freshnessLabel ? (
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              fontWeight: 700,
              color: "#64748b",
            }}
          >
            {freshnessLabel}
          </div>
        ) : null}
      </div>

      {isOwner ? (
        <p
          style={{
            margin: "0 0 4px",
            fontSize: 12,
            fontWeight: 600,
            color: "#94a3b8",
          }}
        >
          {CONFIRMATION_COPY.ownerHint}
        </p>
      ) : null}

      {canVote ? (
        <>
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 14,
              fontWeight: 800,
              color: "#334155",
            }}
          >
            {CONFIRMATION_COPY.prompt}
          </p>
          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            <button
              type="button"
              disabled={saving || !authReady}
              aria-pressed={myStatus === "present"}
              aria-label={CONFIRMATION_COPY.present}
              onClick={() => void castVote("present")}
              style={{
                ...btnBase,
                background: myStatus === "present" ? "#dcfce7" : "#f1f5f9",
                color: myStatus === "present" ? "#166534" : "#334155",
                borderColor:
                  myStatus === "present" ? "#16a34a" : "transparent",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {CONFIRMATION_COPY.present}
            </button>
            <button
              type="button"
              disabled={saving || !authReady}
              aria-pressed={myStatus === "gone"}
              aria-label={CONFIRMATION_COPY.gone}
              onClick={() => void castVote("gone")}
              style={{
                ...btnBase,
                background: myStatus === "gone" ? "#fee2e2" : "#f1f5f9",
                color: myStatus === "gone" ? "#991b1b" : "#334155",
                borderColor: myStatus === "gone" ? "#dc2626" : "transparent",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {CONFIRMATION_COPY.gone}
            </button>
          </div>
        </>
      ) : null}

      {errorMessage ? (
        <div
          role="status"
          style={{
            marginTop: 8,
            fontSize: 12,
            fontWeight: 700,
            color: "#b45309",
          }}
        >
          {errorMessage}
        </div>
      ) : null}
    </div>
  )
}
