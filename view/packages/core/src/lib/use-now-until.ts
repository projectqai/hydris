import { useEffect, useState } from "react";

export function useNowUntil(until: number | undefined): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!until) return;

    setNow(Date.now());

    const id = setInterval(() => {
      const current = Date.now();

      setNow(current);

      if (current >= until) clearInterval(id);
    }, 1000);

    return () => clearInterval(id);
  }, [until]);

  return now;
}
