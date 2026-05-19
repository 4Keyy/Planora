import { redirect } from "next/navigation"

export default function TodosCompletedRedirect() {
  redirect("/branches/completed")
}
