"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function Home() {
  const [msg, setMsg] = useState("Checking Supabase connection...");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("tours").select("id").limit(1);
      if (error) setMsg(`Supabase error: ${error.message}`);
      else setMsg(`Supabase connected ✅ (tours rows found: ${data?.length ?? 0})`);
    })();
  }, []);

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Golf Tour App</h1>
      <p className="mt-4">{msg}</p>
    </main>
  );
}