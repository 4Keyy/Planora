import { ReactNode } from "react"
import { Navbar } from "@/components/layout/navbar"
import { AuthGuard } from "@/components/auth-guard"

export default function CategoriesLayout({ children }: { children: ReactNode }) {
    return (
        <AuthGuard>
            <div className="min-h-screen bg-transparent">
                <Navbar />
                <main className="pt-20">
                    <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-5 lg:px-6 py-8">
                        {children}
                    </div>
                </main>
            </div>
        </AuthGuard>
    )
}
