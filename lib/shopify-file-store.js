import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { isShopifyFilesConfigured } from './runtime-config.js'

const DEFAULT_API_VERSION = process.env.SHOPIFY_API_VERSION?.trim() || '2025-10'
const FILE_READY_TIMEOUT_MS = 30 * 1000
const FILE_READY_POLL_MS = 1500

function normalizeStoreUrl(rawValue) {
  const trimmed = rawValue?.trim()
  if (!trimmed) {
    throw new Error('SHOPIFY_STORE_URL is required')
  }

  const withProtocol =
    trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`

  try {
    const parsed = new URL(withProtocol)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    throw new Error('SHOPIFY_STORE_URL must be a valid store hostname or URL')
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class LocalFileStore {
  async persistAuditRequestAssets(_jobId, auditRequest) {
    return auditRequest
  }

  async uploadReportFiles(_jobId, reportFiles) {
    return reportFiles
  }

  async getDownloadUrl(file) {
    return file?.url ?? null
  }

  async getBuffer(upload) {
    if (upload?.buffer) {
      return upload.buffer
    }

    throw new Error('Local upload buffer is missing')
  }
}

class ShopifyFileStore {
  constructor() {
    this.baseUrl = normalizeStoreUrl(process.env.SHOPIFY_STORE_URL)
    this.adminAccessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim()
    this.apiVersion = DEFAULT_API_VERSION
  }

  graphqlUrl() {
    return `${this.baseUrl}/admin/api/${this.apiVersion}/graphql.json`
  }

  async graphql(query, variables = {}) {
    const response = await fetch(this.graphqlUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.adminAccessToken,
      },
      body: JSON.stringify({ query, variables }),
    })

    if (!response.ok) {
      throw new Error(`Shopify Admin API failed with status ${response.status}`)
    }

    const payload = await response.json()
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw new Error(payload.errors.map((entry) => entry.message).join('; '))
    }

    return payload.data
  }

  contentTypeForMimeType(mimeType) {
    return mimeType.startsWith('image/') ? 'IMAGE' : 'FILE'
  }

  async stagedUploadTarget(fileName, mimeType, fileSize) {
    const query = `
      mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    const data = await this.graphql(query, {
      input: [
        {
          filename: fileName,
          mimeType,
          fileSize: String(fileSize),
          httpMethod: 'POST',
          resource: this.contentTypeForMimeType(mimeType),
        },
      ],
    })

    const result = data?.stagedUploadsCreate
    if (!result) {
      throw new Error('Shopify staged upload did not return a result')
    }

    if (Array.isArray(result.userErrors) && result.userErrors.length > 0) {
      throw new Error(result.userErrors.map((entry) => entry.message).join('; '))
    }

    return result.stagedTargets?.[0] ?? null
  }

  async postToStagedTarget(target, buffer, fileName, mimeType) {
    const formData = new FormData()
    for (const parameter of target.parameters ?? []) {
      formData.append(parameter.name, parameter.value)
    }

    formData.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), fileName)

    const response = await fetch(target.url, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`Shopify staged upload POST failed with status ${response.status}${errorText ? `: ${errorText}` : ''}`)
    }
  }

  async createFileRecord(resourceUrl, contentType, altText = '') {
    const query = `
      mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            __typename
            fileStatus
            ... on GenericFile {
              id
              url
            }
            ... on MediaImage {
              id
              image {
                url
              }
              preview {
                status
                image {
                  url
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    const data = await this.graphql(query, {
      files: [
        {
          alt: altText,
          contentType,
          originalSource: resourceUrl,
        },
      ],
    })

    const result = data?.fileCreate
    if (!result) {
      throw new Error('Shopify fileCreate did not return a result')
    }

    if (Array.isArray(result.userErrors) && result.userErrors.length > 0) {
      throw new Error(result.userErrors.map((entry) => entry.message).join('; '))
    }

    return result.files?.[0] ?? null
  }

  async getFileNode(fileId) {
    const query = `
      query fileNode($id: ID!) {
        node(id: $id) {
          __typename
          ... on GenericFile {
            id
            fileStatus
            url
          }
          ... on MediaImage {
            id
            fileStatus
            image {
              url
            }
            preview {
              status
              image {
                url
              }
            }
          }
        }
      }
    `

    const data = await this.graphql(query, { id: fileId })
    return data?.node ?? null
  }

  extractFileUrl(node) {
    if (!node) return null
    return node.url ?? node.image?.url ?? node.preview?.image?.url ?? null
  }

  async waitForFileUrl(fileId) {
    const deadline = Date.now() + FILE_READY_TIMEOUT_MS

    while (Date.now() < deadline) {
      const node = await this.getFileNode(fileId)
      if (node?.fileStatus === 'FAILED') {
        throw new Error('Shopify rejected the uploaded file')
      }

      const url = this.extractFileUrl(node)
      if (url) {
        return url
      }

      await sleep(FILE_READY_POLL_MS)
    }

    throw new Error('Shopify file did not become ready in time')
  }

  async uploadBuffer(buffer, fileName, mimeType, altText = '') {
    const stagedTarget = await this.stagedUploadTarget(fileName, mimeType, buffer.byteLength)
    if (!stagedTarget) {
      throw new Error('Shopify staged upload target was not returned')
    }

    await this.postToStagedTarget(stagedTarget, buffer, fileName, mimeType)
    const createdFile = await this.createFileRecord(
      stagedTarget.resourceUrl,
      this.contentTypeForMimeType(mimeType),
      altText,
    )

    if (!createdFile?.id) {
      throw new Error('Shopify file record was created without an id')
    }

    const url = this.extractFileUrl(createdFile) ?? (await this.waitForFileUrl(createdFile.id))

    return {
      fileId: createdFile.id,
      url,
      fileName,
      mimeType,
    }
  }

  async persistAuditRequestAssets(jobId, auditRequest) {
    if (!auditRequest?.uploads || Object.keys(auditRequest.uploads).length === 0) {
      return auditRequest
    }

    const uploads = {}
    for (const [uploadKey, upload] of Object.entries(auditRequest.uploads)) {
      const storedFile = await this.uploadBuffer(
        upload.buffer,
        `${jobId}-${uploadKey.replace(/[^a-zA-Z0-9._-]+/g, '-')}-${upload.name}`,
        upload.type || 'image/png',
        `${auditRequest.suite} baseline ${upload.name}`,
      )

      uploads[uploadKey] = {
        name: upload.name,
        type: upload.type || 'image/png',
        fileId: storedFile.fileId,
        url: storedFile.url,
      }
    }

    return {
      ...auditRequest,
      uploads,
    }
  }

  async uploadReportFiles(jobId, reportFiles) {
    const storedFiles = []

    for (const file of reportFiles) {
      const buffer = await readFile(file.path)
      const storedFile = await this.uploadBuffer(
        buffer,
        `${jobId}-${file.fileName}`,
        'application/pdf',
        file.fileName,
      )

      storedFiles.push({
        fileName: file.fileName,
        fileId: storedFile.fileId,
        url: storedFile.url,
      })
    }

    return storedFiles
  }

  async getDownloadUrl(file) {
    if (file?.url) {
      return file.url
    }

    if (!file?.fileId) {
      return null
    }

    return this.waitForFileUrl(file.fileId)
  }

  async getBuffer(upload) {
    if (upload?.buffer) {
      return upload.buffer
    }

    const targetUrl = upload?.url ?? (upload?.fileId ? await this.waitForFileUrl(upload.fileId) : null)
    if (!targetUrl) {
      throw new Error(`Shopify upload URL missing for ${upload?.name ?? 'unknown file'}`)
    }

    const response = await fetch(targetUrl)
    if (!response.ok) {
      throw new Error(`Failed to download Shopify file with status ${response.status}`)
    }

    const bytes = await response.arrayBuffer()
    return Buffer.from(bytes)
  }
}

let singletonStore = null

function getFileStore() {
  if (!singletonStore) {
    singletonStore = isShopifyFilesConfigured() ? new ShopifyFileStore() : new LocalFileStore()
  }

  return singletonStore
}

export { getFileStore }
