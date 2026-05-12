import { Loader } from "@/components/ui/loader";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmButtonText?: string;
  cancelButtonText?: string;
  isLoading?: boolean;
}

export function ConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmButtonText = "Confirm",
  cancelButtonText = "Cancel",
  isLoading,
}: ConfirmationDialogProps) {
  const footer = (
    <div className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      <Button
        variant="destructive"
        onClick={onClose}
        disabled={isLoading}
        className="whitespace-normal"
      >
        {cancelButtonText}
      </Button>
      <Button
        variant="primary"
        onClick={onConfirm}
        disabled={isLoading}
        className="whitespace-normal"
      >
        {isLoading ? (
          <div className="flex items-center gap-2">
            <Loader size="xs" />
            <span>{confirmButtonText}…</span>
          </div>
        ) : (
          confirmButtonText
        )}
      </Button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      footer={footer}
      scrollbarVariant="primary"
    >
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </Modal>
  );
}
