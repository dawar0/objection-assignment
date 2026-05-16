import { useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "#/components/ui/button";

export function BackButton() {
	const router = useRouter();
	return (
		<Button
			variant="ghost"
			size="sm"
			onClick={() => router.history.back()}
			className="-ml-3"
		>
			<ArrowLeft />
			Back
		</Button>
	);
}
