import { Languages } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

const languages = [
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Español' },
]

export function LanguageToggle() {
    const { i18n } = useTranslation()

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="Change language"
                >
                    <Languages className="h-4 w-4" />
                    <span className="sr-only">Change language</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-32 p-1" align="end">
                {languages.map((lang) => (
                    <Button
                        key={lang.code}
                        onClick={() => i18n.changeLanguage(lang.code)}
                        variant={i18n.language === lang.code ? "secondary" : "ghost"}
                        className="w-full justify-start gap-2 h-9 px-2"
                    >
                        {lang.label}
                    </Button>
                ))}
            </PopoverContent>
        </Popover>
    )
}
