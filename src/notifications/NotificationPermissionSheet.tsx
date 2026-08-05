/**
 * Arabic notification permission explanation sheet.
 * Does not call Notification.requestPermission by itself — parent handles enable.
 */

type Props = {
  open: boolean
  busy?: boolean
  errorAr?: string
  onEnable: () => void
  onDismiss: () => void
}

export function NotificationPermissionSheet({
  open,
  busy = false,
  errorAr = "",
  onEnable,
  onDismiss,
}: Props) {
  if (!open) return null

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.55)",
        zIndex: 1000000,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: 16,
        direction: "rtl",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onDismiss()
      }}
    >
      <div
        style={{
          background: "white",
          width: "100%",
          maxWidth: 420,
          borderRadius: 24,
          padding: 22,
          textAlign: "right",
          lineHeight: 1.7,
        }}
      >
        <h2 style={{ margin: "0 0 10px", fontSize: 22, textAlign: "center" }}>
          فعّل الإشعارات
        </h2>
        <p style={{ margin: "0 0 16px", color: "#334155", fontSize: 15 }}>
          فعّل الإشعارات لتعرف فوراً عندما يقبل أحد مساعدتك أو يظهر تنبيه مهم
          قريب منك.
        </p>
        {errorAr ? (
          <p style={{ margin: "0 0 12px", color: "#b91c1c", fontSize: 13 }}>
            {errorAr}
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={onEnable}
          style={{
            width: "100%",
            padding: 14,
            borderRadius: 16,
            border: "none",
            background: busy ? "#64748b" : "#0f172a",
            color: "white",
            fontWeight: "bold",
            fontSize: 16,
            marginBottom: 10,
          }}
        >
          {busy ? "جارٍ التفعيل..." : "فعّل الإشعارات"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDismiss}
          style={{
            width: "100%",
            padding: 14,
            borderRadius: 16,
            border: "none",
            background: "#e5e7eb",
            color: "#0f172a",
            fontWeight: "bold",
            fontSize: 15,
          }}
        >
          ليس الآن
        </button>
      </div>
    </div>
  )
}
