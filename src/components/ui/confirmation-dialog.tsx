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
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="space-y-4">
        {description && (
          <p className="text-sm text-muted">{description}</p>
        )}
        <div className="flex justify-end space-x-2">
          <Button variant="destructive" onClick={onClose}>
            {cancelButtonText}
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader /> {confirmButtonText}
              </>
            ) : (
              confirmButtonText
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
