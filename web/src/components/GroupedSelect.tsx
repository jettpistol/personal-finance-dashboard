import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CheckIcon,
  Combobox,
  InputBase,
  ScrollArea,
  useCombobox,
  type __BaseInputProps,
  type BoxProps,
  type ComboboxProps,
  type ElementProps,
} from '@mantine/core';
import { useId, useUncontrolled } from '@mantine/hooks';
import { IconCaretRightFilled } from '@tabler/icons-react';

export interface GroupedSelectItem {
  value: string;
  label: string;
  disabled?: boolean;
}
export interface GroupedSelectGroup {
  group: string;
  items: GroupedSelectItem[];
}
export type GroupedSelectData = (GroupedSelectItem | GroupedSelectGroup)[];

export interface GroupedSelectProps extends BoxProps, __BaseInputProps, ElementProps<'input', 'onChange' | 'size' | 'value' | 'defaultValue'> {
  /** Groups (`{ group, items }`) and/or flat `{ value, label }` items. */
  data: GroupedSelectData;
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (value: string | null, option: GroupedSelectItem | null) => void;
  searchable?: boolean;
  clearable?: boolean;
  /** Clicking the selected option clears it. Default `false`: it stays selected. */
  allowDeselect?: boolean;
  nothingFoundMessage?: ReactNode;
  comboboxProps?: ComboboxProps;
  maxDropdownHeight?: number | string;
  readOnly?: boolean;
  name?: string;
  onClear?: () => void;
  onDropdownOpen?: () => void;
  onDropdownClose?: () => void;
}

// Header rows are real combobox options (so arrows/Enter reach them), told apart by this prefix.
const GROUP = '__pfd-group__:';

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

const isGroup = (x: GroupedSelectItem | GroupedSelectGroup): x is GroupedSelectGroup => 'group' in x;

/**
 * A Select whose groups collapse. On open only the group holding the current value is
 * expanded; while searching every match shows, under its (expanded) group header.
 */
export function GroupedSelect({
  data,
  value,
  defaultValue,
  onChange,
  searchable,
  clearable,
  allowDeselect = false,
  nothingFoundMessage,
  comboboxProps,
  maxDropdownHeight,
  readOnly,
  disabled,
  name,
  size,
  error,
  id,
  onClear,
  onDropdownOpen,
  onDropdownClose,
  onFocus,
  onBlur,
  onClick,
  ...others
}: GroupedSelectProps) {
  const _id = useId(id);
  const [_value, setValue] = useUncontrolled<string | null>({ value, defaultValue, finalValue: null, onChange });

  const { lookup, groupOf } = useMemo(() => {
    const lookup: Record<string, GroupedSelectItem> = {};
    const groupOf: Record<string, string> = {};
    for (const entry of data) {
      if (isGroup(entry)) {
        for (const it of entry.items) {
          lookup[it.value] = it;
          groupOf[it.value] = entry.group;
        }
      } else lookup[entry.value] = entry;
    }
    return { lookup, groupOf };
  }, [data]);

  const selectedLabel = _value != null ? (lookup[_value]?.label ?? '') : '';
  const labelRef = useRef(selectedLabel);
  labelRef.current = selectedLabel;

  const [search, setSearch] = useState(selectedLabel);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [closedWhileSearching, setClosedWhileSearching] = useState<Set<string>>(new Set());
  const openSource = useRef<string>('unknown');

  const combobox = useCombobox({
    onDropdownOpen: (source) => {
      openSource.current = source;
      const g = _value != null ? groupOf[_value] : undefined;
      setOpenGroups(new Set(g ? [g] : []));
      setClosedWhileSearching(new Set());
      onDropdownOpen?.();
    },
    onDropdownClose: () => {
      setSearch(labelRef.current);
      setTimeout(combobox.resetSelectedOption, 0);
      onDropdownClose?.();
    },
  });

  // Keep the input showing the selected label (value changed from outside, or data loaded late).
  useEffect(() => {
    setSearch(selectedLabel);
  }, [_value, selectedLabel]);

  // Once the open group is rendered: highlight the current value (keyboard) or scroll to it.
  useEffect(() => {
    if (!combobox.dropdownOpened) return;
    const t = window.setTimeout(() => {
      if (openSource.current === 'keyboard') combobox.selectActiveOption();
      else combobox.updateSelectedOptionIndex('active', { scrollIntoView: true });
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combobox.dropdownOpened]);

  const query = searchable && search !== selectedLabel ? fold(search) : '';
  const searching = query !== '';

  const toggle = (group: string) => {
    const flip = (s: Set<string>) => {
      const n = new Set(s);
      if (n.has(group)) n.delete(group);
      else n.add(group);
      return n;
    };
    if (searching) setClosedWhileSearching(flip);
    else setOpenGroups(flip);
  };

  const renderItem = (it: GroupedSelectItem) => {
    const checked = it.value === _value;
    return (
      <Combobox.Option
        key={it.value}
        value={it.value}
        disabled={it.disabled}
        className={Combobox.classes.optionsDropdownOption}
        data-checked={checked || undefined}
        aria-selected={checked}
        active={checked}
      >
        {/* The tick goes at the end so the name never moves when it's selected. */}
        <span className="pfd-gs-label">{it.label}</span>
        {checked && <CheckIcon className={Combobox.classes.optionsDropdownCheckIcon} />}
      </Combobox.Option>
    );
  };

  const matches = (it: GroupedSelectItem) => !searching || fold(it.label).includes(query);
  let shown = 0;
  const content = data.map((entry, gi) => {
    if (!isGroup(entry)) {
      if (!matches(entry)) return null;
      shown++;
      return renderItem(entry);
    }
    const items = entry.items.filter(matches);
    if (searching && !items.length) return null;
    shown += items.length;
    const open = searching ? !closedWhileSearching.has(entry.group) : openGroups.has(entry.group);
    const headerId = `${_id}-group-${gi}`;
    return (
      <div key={`g:${entry.group}`} role="group" aria-labelledby={headerId} className="pfd-gs-group">
        <Combobox.Option value={GROUP + entry.group} id={headerId} className="pfd-gs-groupLabel" aria-expanded={open} data-open={open || undefined}>
          <IconCaretRightFilled size={11} className="pfd-gs-caret" aria-hidden />
          <span className="pfd-gs-name">{entry.group}</span>
        </Combobox.Option>
        {open && items.map(renderItem)}
      </div>
    );
  });
  const isEmpty = shown === 0;

  const clearButton = (
    <Combobox.ClearButton
      onClear={() => {
        setValue(null, null);
        setSearch('');
        onClear?.();
      }}
    />
  );

  return (
    <>
      <Combobox
        store={combobox}
        size={size}
        readOnly={readOnly}
        onOptionSubmit={(val) => {
          if (val.startsWith(GROUP)) {
            toggle(val.slice(GROUP.length));
            return;
          }
          const next = allowDeselect && val === _value ? null : val;
          if (next !== _value) setValue(next, next == null ? null : (lookup[next] ?? null));
          combobox.closeDropdown();
        }}
        {...comboboxProps}
      >
        <Combobox.Target targetType={searchable ? 'input' : 'button'}>
          <InputBase
            id={_id}
            __defaultRightSection={<Combobox.Chevron size={size} error={error} />}
            __clearSection={clearButton}
            __clearable={!!clearable && _value != null && !disabled && !readOnly}
            rightSectionPointerEvents="none"
            {...others}
            size={size}
            error={error}
            disabled={disabled}
            readOnly={readOnly || !searchable}
            pointer={!searchable}
            value={search}
            onChange={(e) => {
              setSearch(e.currentTarget.value);
              combobox.openDropdown();
              combobox.resetSelectedOption();
            }}
            onFocus={(e) => {
              if (searchable) combobox.openDropdown();
              onFocus?.(e);
            }}
            onBlur={(e) => {
              if (searchable) combobox.closeDropdown();
              setSearch(labelRef.current);
              onBlur?.(e);
            }}
            onClick={(e) => {
              if (searchable) combobox.openDropdown();
              else combobox.toggleDropdown();
              onClick?.(e);
            }}
          />
        </Combobox.Target>
        <Combobox.Dropdown hidden={readOnly || disabled || (isEmpty && !nothingFoundMessage)} data-composed className="pfd-gs-dropdown">
          <Combobox.Options labelledBy={others.label ? `${_id}-label` : undefined} aria-label={others.label ? undefined : others['aria-label']}>
            <ScrollArea.Autosize mah={maxDropdownHeight ?? 220} type="scroll" scrollbarSize="var(--combobox-padding)" offsetScrollbars="y">
              {content}
            </ScrollArea.Autosize>
            {isEmpty && nothingFoundMessage && <Combobox.Empty>{nothingFoundMessage}</Combobox.Empty>}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>
      {name && <Combobox.HiddenInput value={_value} name={name} disabled={disabled} />}
    </>
  );
}
