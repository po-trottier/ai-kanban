import {
  Button,
  Checkbox,
  Container,
  Group,
  Paper,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useCardSearch } from '../api/card.ts'
import { utcToday } from '../lib/format.ts'
import { ErrorAlert } from '../shell/ErrorAlert.tsx'
import { strings } from '../strings.ts'
import { EMPHASIS_FONT_WEIGHT, SIZES } from '../theme.ts'
import { CardBadges } from './CardBadges.tsx'

/**
 * The card list/search view over `GET /cards`: substring query plus the
 * include-archived filter (docs/user/guide.md) — the one place archived cards
 * are reachable so they can be reopened from their detail panel.
 */
export function CardSearchPage() {
  const navigate = useNavigate()
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const search = useCardSearch({ q, includeArchived })
  const cards = (search.data?.pages ?? []).flatMap((page) => page.items)
  const today = utcToday()

  return (
    <Container size="md" w="100%">
      <Stack gap="md">
        <Title order={2} size="h3">
          {strings.search.pageTitle}
        </Title>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            setQ(draft.trim())
          }}
        >
          <Group align="flex-end" gap="sm">
            <TextInput
              label={strings.search.queryLabel}
              value={draft}
              onChange={(event) => {
                setDraft(event.currentTarget.value)
              }}
            />
            <Button type="submit">{strings.search.submit}</Button>
          </Group>
        </form>
        <Checkbox
          label={strings.search.includeArchived}
          checked={includeArchived}
          onChange={(event) => {
            setIncludeArchived(event.currentTarget.checked)
          }}
        />
        {search.error !== null ? (
          <ErrorAlert error={search.error} fallbackMessage={strings.search.loadFailed} />
        ) : search.isPending ? (
          <Skeleton height={SIZES.skeletonCardHeight} radius="md" />
        ) : cards.length === 0 ? (
          <Text size="sm" c="dimmed">
            {strings.search.empty}
          </Text>
        ) : (
          <Stack gap="xs" role="list" aria-label={strings.search.resultsLabel}>
            {cards.map((card) => (
              <div role="listitem" key={card.id}>
                <UnstyledButton
                  w="100%"
                  onClick={() => {
                    void navigate(`/cards/${card.id}`)
                  }}
                >
                  <Paper withBorder p="sm" radius="md">
                    <Group justify="space-between" gap="xs">
                      <Text size="sm" fw={EMPHASIS_FONT_WEIGHT}>
                        {card.title}
                      </Text>
                      <CardBadges card={card} today={today} />
                    </Group>
                  </Paper>
                </UnstyledButton>
              </div>
            ))}
            {search.hasNextPage ? (
              <Button
                variant="subtle"
                size="xs"
                loading={search.isFetchingNextPage}
                onClick={() => {
                  void search.fetchNextPage()
                }}
              >
                {strings.common.loadMore}
              </Button>
            ) : null}
          </Stack>
        )}
      </Stack>
    </Container>
  )
}
