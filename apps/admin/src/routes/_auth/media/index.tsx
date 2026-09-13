import { createFileRoute } from '@tanstack/react-router'
import { MediaGrid } from '../../../components/media/MediaGrid.tsx'
import { UploadDropzone } from '../../../components/media/UploadDropzone.tsx'
import { PageHeading } from '../../../components/PageHeading.tsx'

export const Route = createFileRoute('/_auth/media/')({ component: MediaPage })

function MediaPage() {
  return (
    <div>
      <PageHeading title="メディア" description="画像と PDF をアップロードして管理します。" />
      <div className="mt-6">
        <UploadDropzone />
      </div>
      <div className="mt-8">
        <MediaGrid />
      </div>
    </div>
  )
}
