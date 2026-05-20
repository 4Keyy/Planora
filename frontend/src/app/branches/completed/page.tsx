"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function CompletedBranchesRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace("/tasks/completed") }, [router])
  return null
}
