import { AnyAction } from '@reduxjs/toolkit';

import {
  QueryVariableModel,
  VariableHide,
  VariableModel,
  VariableOption,
  VariableRefresh,
  VariableSort,
  VariableTag,
} from '../variable';
import {
  addVariable,
  hideQueryVariableDropDown,
  removeInitLock,
  resolveInitLock,
  selectVariableOption,
  setCurrentVariableValue,
  setInitLock,
  showQueryVariableDropDown,
  updateVariableOptions,
  updateVariableTags,
} from './actions';
import _ from 'lodash';
import { stringToJsRegex } from '@grafana/data';
import templateSrv from '../template_srv';
import { Deferred } from '../deferred';

export type MutateStateFunc<S extends VariableState> = (state: S) => S;
export const appyStateChanges = <S extends VariableState>(state: S, ...args: Array<MutateStateFunc<S>>): S => {
  return args.reduce((all, cur) => {
    return cur(all);
  }, state);
};

export interface VariableState<P extends {} = {}, M extends VariableModel = VariableModel> {
  picker: P;
  variable: M;
}

export interface QueryVariablePickerState {
  showDropDown: boolean;
  linkText: string | string[];
  selectedValues: VariableOption[];
  selectedTags: VariableTag[];
  searchQuery: string;
  searchOptions: VariableOption[];
  highlightIndex: number;
  tags: VariableTag[];
  options: VariableOption[];
  queryHasSearchFilter: boolean;
  oldVariableText: string | string[];
}

export interface QueryVariableState extends VariableState<QueryVariablePickerState, QueryVariableModel> {}

export const initialQueryVariablePickerState: QueryVariablePickerState = {
  highlightIndex: -1,
  linkText: null,
  queryHasSearchFilter: false,
  searchOptions: [],
  searchQuery: null,
  selectedTags: [],
  selectedValues: [],
  showDropDown: false,
  tags: [],
  options: [],
  oldVariableText: null,
};

export const initialQueryVariableModelState: QueryVariableModel = {
  global: false,
  index: -1,
  type: 'query',
  name: '',
  label: null,
  hide: VariableHide.dontHide,
  skipUrlSync: false,
  datasource: null,
  query: '',
  regex: '',
  sort: VariableSort.disabled,
  refresh: VariableRefresh.never,
  multi: false,
  includeAll: false,
  allValue: null,
  options: [],
  current: {} as VariableOption,
  tags: [],
  useTags: false,
  tagsQuery: '',
  tagValuesQuery: '',
  definition: '',
};

export const initialQueryVariableState: QueryVariableState = {
  picker: initialQueryVariablePickerState,
  variable: initialQueryVariableModelState,
};

export const ALL_VARIABLE_TEXT = 'All';
export const ALL_VARIABLE_VALUE = '$__all';
export const NONE_VARIABLE_TEXT = 'None';
export const NONE_VARIABLE_VALUE = '';

const sortVariableValues = (options: any[], sortOrder: VariableSort) => {
  if (sortOrder === VariableSort.disabled) {
    return options;
  }

  const sortType = Math.ceil(sortOrder / 2);
  const reverseSort = sortOrder % 2 === 0;

  if (sortType === 1) {
    options = _.sortBy(options, 'text');
  } else if (sortType === 2) {
    options = _.sortBy(options, opt => {
      const matches = opt.text.match(/.*?(\d+).*/);
      if (!matches || matches.length < 2) {
        return -1;
      } else {
        return parseInt(matches[1], 10);
      }
    });
  } else if (sortType === 3) {
    options = _.sortBy(options, opt => {
      return _.toLower(opt.text);
    });
  }

  if (reverseSort) {
    options = options.reverse();
  }

  return options;
};

const metricNamesToVariableValues = (variableRegEx: string, sort: VariableSort, metricNames: any[]) => {
  let regex, i, matches;
  let options: VariableOption[] = [];

  if (variableRegEx) {
    regex = stringToJsRegex(templateSrv.replace(variableRegEx, {}, 'regex'));
  }
  for (i = 0; i < metricNames.length; i++) {
    const item = metricNames[i];
    let text = item.text === undefined || item.text === null ? item.value : item.text;

    let value = item.value === undefined || item.value === null ? item.text : item.value;

    if (_.isNumber(value)) {
      value = value.toString();
    }

    if (_.isNumber(text)) {
      text = text.toString();
    }

    if (regex) {
      matches = regex.exec(value);
      if (!matches) {
        continue;
      }
      if (matches.length > 1) {
        value = matches[1];
        text = matches[1];
      }
    }

    options.push({ text: text, value: value, selected: false });
  }

  options = _.uniqBy(options, 'value');
  return sortVariableValues(options, sort);
};

const updateLinkText = (state: QueryVariableState): QueryVariableState => {
  const { current, options } = state.variable;

  if (!current.tags || current.tags.length === 0) {
    return {
      ...state,
      picker: {
        ...state.picker,
        linkText: current.text,
      },
    };
  }

  // filer out values that are in selected tags
  const selectedAndNotInTag = options.filter(option => {
    if (!option.selected) {
      return false;
    }
    for (let i = 0; i < current.tags.length; i++) {
      const tag = current.tags[i];
      const foundIndex = tag.values.findIndex(v => v === option.value);
      if (foundIndex !== -1) {
        return false;
      }
    }
    return true;
  });

  // convert values to text
  const currentTexts = selectedAndNotInTag.map(s => s.text);

  // join texts
  const newLinkText = currentTexts.join(' + ');
  return {
    ...state,
    picker: {
      ...state.picker,
      linkText: newLinkText.length > 0 ? `${newLinkText} + ` : newLinkText,
    },
  };
};

const updateSelectedValues = (state: QueryVariableState): QueryVariableState => {
  return {
    ...state,
    picker: {
      ...state.picker,
      selectedValues: state.variable.options.filter(o => o.selected),
    },
  };
};

const updateSelectedTags = (state: QueryVariableState): QueryVariableState => {
  return {
    ...state,
    picker: {
      ...state.picker,
      selectedTags: state.variable.tags.filter(t => t.selected),
    },
  };
};

const updateOptions = (state: QueryVariableState): QueryVariableState => {
  return {
    ...state,
    picker: {
      ...state.picker,
      options: state.variable.options.slice(0, Math.min(state.variable.options.length, 1000)),
    },
  };
};

// I stumbled upon the error described here https://github.com/immerjs/immer/issues/430
// So reverting to a "normal" reducer
export const queryVariableReducer = (
  state: QueryVariableState = initialQueryVariableState,
  action: AnyAction
): QueryVariableState => {
  if (addVariable.match(action)) {
    const {
      type,
      name,
      label,
      hide,
      skipUrlSync,
      datasource,
      query,
      regex,
      sort,
      refresh,
      multi,
      includeAll,
      allValue,
      options,
      current,
      tags,
      useTags,
      tagsQuery,
      tagValuesQuery,
      definition,
    } = action.payload.model as QueryVariableModel;
    return {
      ...state,
      variable: {
        ...state.variable,
        global: action.payload.global,
        index: action.payload.index,
        type,
        name,
        label,
        hide,
        skipUrlSync,
        datasource,
        query,
        regex,
        sort,
        refresh,
        multi,
        includeAll,
        allValue,
        options,
        current,
        tags,
        useTags,
        tagsQuery,
        tagValuesQuery,
        definition,
      },
    };
  }

  if (updateVariableOptions.match(action)) {
    const results = action.payload.results;
    const { regex, includeAll, sort } = state.variable;
    const options = metricNamesToVariableValues(regex, sort, results);
    if (includeAll) {
      options.unshift({ text: ALL_VARIABLE_TEXT, value: ALL_VARIABLE_VALUE, selected: false });
    }
    if (!options.length) {
      options.push({ text: NONE_VARIABLE_TEXT, value: NONE_VARIABLE_VALUE, isNone: true, selected: false });
    }

    return { ...state, variable: { ...state.variable, options } };
  }

  if (updateVariableTags.match(action)) {
    const results = action.payload.results;
    const tags: VariableTag[] = [];
    for (let i = 0; i < results.length; i++) {
      tags.push({ text: results[i].text, selected: false });
    }

    return { ...state, variable: { ...state.variable, tags } };
  }

  if (setCurrentVariableValue.match(action)) {
    const current = action.payload.current;

    if (Array.isArray(current.text) && current.text.length > 0) {
      current.text = current.text.join(' + ');
    } else if (Array.isArray(current.value) && current.value[0] !== ALL_VARIABLE_VALUE) {
      current.text = current.value.join(' + ');
    }

    const newState = {
      ...state,
      variable: {
        ...state.variable,
        current,
        options: state.variable.options.map(option => {
          let selected = false;
          if (Array.isArray(current.value)) {
            for (let index = 0; index < current.value.length; index++) {
              const value = current.value[index];
              if (option.value === value) {
                selected = true;
                break;
              }
            }
          } else if (option.value === current.value) {
            selected = true;
          }
          return {
            ...option,
            selected,
          };
        }),
      },
    };

    return appyStateChanges(newState, updateLinkText, updateOptions, updateSelectedValues, updateSelectedTags);
  }

  if (setInitLock.match(action)) {
    return { ...state, variable: { ...state.variable, initLock: new Deferred() } };
  }

  if (resolveInitLock.match(action)) {
    // unfortunate side effect in reducer
    state.variable.initLock.resolve();
    return { ...state };
  }

  if (removeInitLock.match(action)) {
    return { ...state, variable: { ...state.variable, initLock: null } };
  }

  if (selectVariableOption.match(action)) {
    const { option, forceSelect, event } = action.payload;
    const { multi } = state.variable;
    const newOptions: VariableOption[] = state.variable.options.map(o => {
      if (o.value !== option.value) {
        let selected = o.selected;
        if (o.text === ALL_VARIABLE_TEXT || option.text === ALL_VARIABLE_TEXT) {
          selected = false;
        } else if (!multi) {
          selected = false;
        } else if (event.ctrlKey || event.metaKey || event.shiftKey) {
          selected = false;
        }
        return {
          ...o,
          selected,
        };
      }
      const selected = forceSelect ? true : multi ? !option.selected : true;
      return {
        ...o,
        selected,
      };
    });
    if (newOptions.length > 0 && newOptions.filter(o => o.selected).length === 0) {
      newOptions[0].selected = true;
    }
    const newState = {
      ...state,
      variable: {
        ...state.variable,
        options: newOptions,
      },
    };

    return appyStateChanges(newState, updateLinkText, updateOptions, updateSelectedValues, updateSelectedTags);
  }

  if (showQueryVariableDropDown.match(action)) {
    const { current } = state.variable;
    const oldVariableText = current.text;
    const highlightIndex = -1;
    const showDropDown = true;
    // new behaviour, if this is a query that uses searchfilter it might be a nicer
    // user experience to show the last typed search query in the input field
    const searchQuery = state.picker.queryHasSearchFilter && state.picker.searchQuery ? state.picker.searchQuery : '';

    const newState = {
      ...state,
      picker: {
        ...state.picker,
        oldVariableText,
        highlightIndex,
        searchQuery,
        showDropDown,
      },
    };

    return appyStateChanges(newState, updateLinkText, updateOptions, updateSelectedValues, updateSelectedTags);
  }

  if (hideQueryVariableDropDown.match(action)) {
    const newState = { ...state, picker: { ...state.picker, showDropDown: false } };

    return appyStateChanges(newState, updateLinkText, updateOptions, updateSelectedValues, updateSelectedTags);
  }

  return state;
};

export const initialQueryVariablesState: QueryVariableState[] = [];

export const updateChildState = (
  state: QueryVariableState[],
  type: string,
  name: string,
  action: AnyAction
): QueryVariableState[] => {
  if (type !== 'query') {
    return state;
  }

  const instanceIndex = state.findIndex(child => child.variable.name === name);
  const instanceState = state[instanceIndex];
  return state.map((v, index) => {
    if (index !== instanceIndex) {
      return v;
    }

    return {
      ...v,
      ...queryVariableReducer(instanceState, action),
    };
  });
};

export const queryVariablesReducer = (
  state: QueryVariableState[] = initialQueryVariablesState,
  action: AnyAction
): QueryVariableState[] => {
  if (addVariable.match(action)) {
    if (action.payload.model.type !== 'query') {
      return state;
    }

    const variable = queryVariableReducer(undefined, action);
    return [...state, variable];
  }

  if (updateVariableOptions.match(action)) {
    const { type, name } = action.payload.variable;
    return updateChildState(state, type, name, action);
  }

  if (updateVariableTags.match(action)) {
    const { type, name } = action.payload.variable;
    return updateChildState(state, type, name, action);
  }

  if (setCurrentVariableValue.match(action)) {
    const { type, name } = action.payload.variable;
    return updateChildState(state, type, name, action);
  }

  if (setInitLock.match(action)) {
    const { type, name } = action.payload;
    return updateChildState(state, type, name, action);
  }

  if (resolveInitLock.match(action)) {
    const { type, name } = action.payload;
    return updateChildState(state, type, name, action);
  }

  if (removeInitLock.match(action)) {
    const { type, name } = action.payload;
    return updateChildState(state, type, name, action);
  }

  if (selectVariableOption.match(action)) {
    const { type, name } = action.payload.variable;
    return updateChildState(state, type, name, action);
  }

  if (showQueryVariableDropDown.match(action)) {
    const { type, name } = action.payload;
    return updateChildState(state, type, name, action);
  }

  if (hideQueryVariableDropDown.match(action)) {
    const { type, name } = action.payload;
    return updateChildState(state, type, name, action);
  }

  return state;
};
