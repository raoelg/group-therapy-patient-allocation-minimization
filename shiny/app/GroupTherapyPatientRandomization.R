require(tidyverse)

#' Compute the count imbalance in a 2D table
#' 
#' This function computes the imballance between cell counts in a table. 
#' Natural measures are chi-square, total within column variance, and between
#' column totals variance. This function computes a weighted combination of 
#' these.
#' 
#' @param O O is a contingency table; e.g., the result of 
#'  ftable(<data frame>, col.vars = "arm") in a clinical trial 
#' @param chi2 is the weight given to the chi-square component
#' @param WSS is the weight given to the sum of within column variances
#' @param BSS is the weight given to column totals variance
#' 
#' @return A scalar value: chi2 * chi-square measure + WSS * sum of column 
#'         variances + BSS * variance of column totals
#' @export
#' 
#' @examples 
#' df = data.frame(F1 = sample(c('m','f'), 100, T), F2 = sample(4, 100, T),
#'       arm = sample(c('A','B','cntrl'), 100, T))
#' ftable_imbalance(ftable(df, col.vars="arm"))
ftable_imbalance = function(O, chi2=1, WSS=0, BSS=0) {
  E = outer(rowSums(O), colSums(O)) / sum(O) + 0.0001
  X2 = sum((O-E)^2 / E)
  V = apply(O, 1, var) %>% sum()
  mvar = var(colMeans(O))
  chi2*X2 + WSS*V + BSS*mvar
}


#' Optimal allocation of groups of new patients to trial arms in ongoing group 
#' therapy.
#' 
#' Given a data frame 'df' with an "arm" column of previously allocated patients,
#' a 'new' data frame for which the "arm" column needs to be found that makes 
#' ftable(rbind(df,new)) as 'balanced' as possible, and a vector of available
#' spots in the different arms, this function tries to find an allocation that
#' maintains the overall group count 'equalness' on relevant covariates. Since 
#' this is an NP complete problem, it uses a search strategy to find the 
#' allocation among all possible allocations that minimizes a measure of 
#' 'imbalance' (as computed by 'ftable_imbalance'). A record of all considered 
#' allocations is retained along with the associated imbalances. 
#' 
#' @param df The data frame that contains covariate factors and an "arm" factor
#'           that specifies all already allocated patients
#' @param new The data frame that contains the same covariate factors as 'df'
#'            but not the "arm" factor for patiens that need to be allocated
#' @param k  A named vector containing the number of available spots for each
#'           level of the "arm" column in 'df'. All names(k) should be in
#'           levels(df$arm). 
#'
#' @details The algorithm operates on the contingency table defined by the co-
#'          variate factor levels on the one hand and the levels of "arm" factor
#'          on the other hand. The covariate factor levels define the patient
#'          strata, and the aim is to distribute the available spots in 'k' 
#'          accross the strata in such a way that each stratum in the end has
#'          the most ballanced possible distribution of patiens across the arms.
#'          The algorithm starts with a random allocation of the available 
#'          patients in 'new' to the arms in such a way that the number of 
#'          available spots in each arms in not exceded. If there are more patients
#'          than spots available, patiens are placed in a newly created 'wait'
#'          arm. If there are more spots than patients available spots remain
#'          unfilled. Starting from this random allocation, the algorithm 
#'          systematically searches an exchange between arms of two patients in 
#'          different strata and that minimizes the total imbalance. This 
#'          "best move" is then used as the new starting point, and the process 
#'          is repeated until no further reduction in the imbalance measure can 
#'          be made.
#'
#' @return An ftable computed with col.vars = "arms" from 'new' (See help(ftable))
#'         with counts for each covariate factor defined stratum. The table total
#'         is equal to the number of rows in 'new'. The column totals are equal to
#'         or less than the values in 'k', except for the extra column named 'wait'
#'         which contains the counts of patients within each covariate factor 
#'         stratum that could not be placed in any of the "arm"'s levels without
#'         exceeding the corresponding value in 'k'. If the "wait" column is removed
#'         and the remaining table is added to the result of 
#'         ftable(df, col.vars = "arms"), the resulting table of counts has the
#'         lowest imbalance measure that the search strategy could find. The
#'         output has an attribute called "all_counts" that is a list of all
#'         the tables that it tried. The trace consists of a list of lists, 
#'         each with the numeric scalar 'imb' and an ftable 'counts'.
#'         
#' @seealso ftable_imbalance, sampleAllocation, matchPos
#' 
#' @examples 
#' df = data.frame(F1 = sample(c('m','f'), 30, T), F2 = sample(4, 30, T),
#'       arm = sample(c('A','B','cntrl'), 30, T))
#' new = data.frame(F1 = sample(c('m','f'), 5, T), F2 = sample(4, 5, T))
#' k = c(A=1, B=2, cntrl=1)
#' alloc = generatePatientAllocation3(df, new, k)
#' colSums(alloc) # except for 'wait' values should be smaller than or equal to k
#' attr(alloc, 'trace') # the entire trace of all tried allocations
#' 
generatePatientAllocation3 = function(df, new, k, trace = FALSE) {
  K = c(k, wait = pmax(0, nrow(new) - sum(k)))
  levels_wait = c(levels(df$arm), "wait")
  nnew = nrow(new)
  newAlloc = cbind(new, arm = factor(sample(rep(names(K), K))[1:nnew], levels = levels_wait))
  
  # only cell frequencies matter, work with cross-tables for efficiency:
  current_counts = ftable(transform(df,arm=factor(arm,levels=levels_wait)), col.vars = "arm") 
  new_counts = ftable(newAlloc, col.vars = "arm")
  imb = ftable_imbalance(current_counts + new_counts)
  non_zero_rows = sample(which(rowSums(new_counts) > 0)) # randomize to prevent order effects
  decr = 1
  all_counts = list(list(imb = imb, counts = new_counts))
  while(decr > 0) {
    best_counts_sofar = new_counts
    best_imb = imb
    
    # find the best move (move=one exchange of two patients)
    keep_new_counts = new_counts
    all_considered = vector("list", ncol(new_counts)^2 * length(non_zero_rows)^2)
    k=0
    for (i in non_zero_rows) 
      for (j in non_zero_rows) {
        if (i >= j) next # exchanging i and j within stratum leaves imbalance unchanged, don't do everything twice
        for (col_from in 1:ncol(new_counts)) 
          for (col_to in 1:ncol(new_counts)) {
            new_counts = keep_new_counts
            if (col_to == col_from) next # to and from should be different
            if (new_counts[i, col_from] < 1) next # nothing to move
            if (new_counts[j, col_to  ] < 1) next 
            new_counts[i, col_from] = new_counts[i, col_from] - 1
            new_counts[i, col_to  ] = new_counts[i, col_to  ] + 1
            new_counts[j, col_to  ] = new_counts[j, col_to  ] - 1
            new_counts[j, col_from] = new_counts[j, col_from] + 1
            new_imb = ftable_imbalance(current_counts + new_counts)
            if (new_imb < best_imb) {
              best_counts_sofar = new_counts
              best_imb = new_imb
            }
            if (trace) cat("old imb = ", imb, " patients ",i," and ",j ," (cols: ", col_from, ", ", col_to, ") new imb = ", new_imb, "\n", sep="")
            k = k+1
            all_considered[[k]] = list(imb = new_imb, counts = new_counts)
          }
      }
    all_counts = c(all_counts, Filter(function(x) length(x)>0, all_considered))
    
    # update 
    new_counts = best_counts_sofar
    decr = imb - best_imb
    imb = best_imb 
  }
  if (trace) cat("best imb = ", imb, "\n", sep="")
  structure(new_counts, trace = all_counts)
}

#' Sample an allocation from a generatePatientAllocation3 allocation trace
#' 
#' generatePatientAllocation3 returns the best balanced allocation it could find,
#' plus a trace of all the allocations it evaluated. This function samples one
#' of those allocations with probability proportional a^ftable_imbalance, where
#' a > 0.
#' 
#' @param allocation An allocation returned by generatePatientAllocation3
#' @param a A value for a; defaults to exp(-1/2)
#' 
#' @return a randomly drawn ftable from attr(allocation, 'trace')
#' 
#' @seealso generatePatientAllocation3, groupTherapyAllocate
#' 
sampleAllocation = function(allocation, a=exp(-.2231436)) {
  f = function(x, a=1) 1/rowSums(a^-outer(x,x,'-')) # = a^x / sum(a^x) but works for large values in x
  f = function(x, a=.8, e1=c(1,rep(0,length(x)-1))) a * e1 + (1-a) * (1-e1)/sum(1-e1) # optimal with P=80% any other with equal probability
  sample_from = function(x, size, replace = FALSE, prob = NULL) if (length(x) == 1) rep(x, size) else sample(x, size, replace, prob)
  imb  =  sapply(attr(allocation, 'trace'),function(x) x$imb)
  x = sort(unique(round(imb, 10)))
  if (length(x) == 1) return(attr(allocation, 'trace')[1])
  breaks = c(0, x + min(diff(x))/2, Inf)
  y = cut(x, breaks)
  p.y = f(x, a)
  g = cut(imb, breaks)
  k = sample_from(y, 1, prob = p.y)
  i = sample_from(which(g == k),1)
  attr(allocation, 'trace')[i]
} 


#' Match stratum allocations with actual patient IDs
#' 
#' Given an ftable of (possibly optimal) stratum allocation counts to different 
#' "arm" levels, match actual patients to these allocations, randomizing patients
#' within strata.
#' 
#' @param allocation An ftable with counts that totals to the number of rows in 
#'                   'new'
#' @param new A data frame that defines the same strate as defined in 'allocation'
#'            that holds actual patients. ftable(new, col.vars="arm") should
#'            have the same rows with the same row totals as 'allocation'.
#' 
#' @examples 
#' set.seed(4)
#' new = data.frame(F1 = sample(c('m','f'), 5, T), F2 = factor(sample(4, 5, T)))
#' alloc = cbind(nnew, arm=sample(c("A","cntrl"),5,T))
#' matchPositionsPatients(ftable(alloc), new) # allocation differs from alloc
#' matchPositionsPatients(ftable(alloc), new) # same as alloc
#' 
matchPositionsPatients = function(allocation, new) {
  # Positions are matched with patients by listing allocated spots in a data frame 
  # with all stratifying variables and finding matching patients in the new data frame.
  # Matching can only be done by ordering. Within patient segments arm is then still
  # randomized (which currently does not take into account waiting time and wait list
  # allocation)
  draw = allocation
  positions = as.data.frame(draw) %>% 
    as_tibble %>% filter(Freq > 0) %>% 
    {x = .; x[rep(1:nrow(x), x$Freq),]} %>% 
    arrange_all() %>% 
    rownames_to_column()
  patients = new %>% 
    rownames_to_column() %>% 
    rename(patient_id = rowname) %>% 
    arrange_at(vars(-patient_id)) %>% 
    rownames_to_column() 
  placement = full_join(patients, positions, intersect(names(patients),names(positions))) %>% select(-rowname, -Freq) 
  placement %>% group_by_at(vars(-patient_id,-arm)) %>% mutate(patient_id = sample(patient_id)) %>% arrange(patient_id)
}


#' Allocate a set of new patients to an ongoing trial of group therapies balancing 
#' on a set of covariate factors.
#' 
#' Computes an (random) allocation of new patients to available group therapy spots
#' in different study arms such that it minimizes the between arm imbalance with
#' respect to strata defined by covariate factors.
#' 
#' @param existing_patients A data frame that specifies for each already 
#'        participating patient the covariate factor levels they belong to and 
#'        the treatment arm in the factor "arm"
#' @param new_patients A data frame that specifies for each new patient the
#'        covariate factors levels they belong to
#' @param k A named vector of available spots in each arm. The names must be levels
#'        of the "arm" factor in existing_patients
#' @param patient_id_column An integer or name that indicates the column in 
#'        'new_patients' with patient ID's. Defaults to FALSE, in which case it
#'        is assumed no patient ID's are available and the row number of the
#'        patients in 'new_patients' is used as their ID. If the name is not
#'        a column name of new_patients or existing_patients, it is *silently*
#'        ignored.
#' @param predictability A numeric that specifies how predictable the allocation
#'        should be from the imbalance function of all possible allocations. Higher
#'        values correspond to higher predictability, however the value 1 often
#'        already corresponds to almost perfect predictability. A value of 0
#'        corresponds to complete unpredictability.
#'        
#' @details For a description of the algorithm see \link{generatePatientAllocation3} and
#'        \link{matchPositionsPatients}.
#'        
#' @return The 'new_patients' data frame with the column 'arm' added with the 
#'        computed allocation.
#'
#' @seealso generatePatientAllocation3, matchPositionsPatients
#' 
#' @examples 
#' set.seed(4)
#' df = data.frame(F1 = sample(c('m','f'), 30, T), F2 = sample(4, 30, T),
#'       arm = sample(c('A','B','cntrl'), 30, T))
#' new = data.frame(F1 = sample(c('m','f'), 5, T), F2 = sample(4, 5, T))
#' k = c(A=1, B=2, cntrl=1)
#' alloc = groupTherapyAllocate(df, new, k, predictability = 100) 
#' 
groupTherapyAllocate = function(existing_patients, new_patients, k, patient_id_column = FALSE, predictability=1) {
  require(dplyr)

    
  pid = if (is.numeric(patient_id_column)) names(new_patients)[patient_id_column] else patient_id_column
  the_df = if (pid %in% names(existing_patients)) {existing_patients %>% select(-patient_id_column)} else existing_patients
  new = if (pid %in% names(new_patients)) {new_patients %>% select(-patient_id_column)} else new_patients

  extra_name = union(setdiff(names(the_df), names(new)),setdiff(names(new), names(the_df)))
  if (length(extra_name) > 1 | extra_name != "arm" | is.null(the_df$arm)) 
    stop("The only difference between ", deparse(substitute(existing_patients)), " and ", deparse(substitute(new_patients)), 
         " should be an extra 'arm' column in ", deparse(substitute(existing_patients)),".\n  Specify 'patient_id_column' to",
         " indicate an extra patient id column in ", deparse(substitute(new_patients)),".")
  if (! all(names(k) %in% the_df$arm))
    stop("The array ", deparse(substitute(k)), " should be named with names that are levels in ", 
         deparse(substitute(existing_patients)), '[,"arm"].')

  # make sure that all factors in df and newAlloc have same levels
  for(nm in names(new)) {
    the_df[[nm]] = factor(the_df[[nm]])
    new[[nm]] = factor(new[[nm]], levels(the_df[[nm]]))
  }
    
  alloc = generatePatientAllocation3(the_df, new, k)
  alloc = sampleAllocation(alloc, predictability)[[1]]$counts
  alloc = matchPositionsPatients(alloc, new)
  alloc = if (pid %in% names(new_patients)) { #{alloc[,pid] = new_patients[, pid][as.integer(alloc$patient_id)]; alloc} else alloc
    mutate(alloc, patient_id = new_patients[,pid][as.integer(patient_id)]) %>% rename(!!pid := patient_id)
  } else alloc
  existing_patients = as_tibble(as.matrix(as.data.frame(existing_patients)))
  alloc = as_tibble(as.matrix(as.data.frame(alloc)))
  combined = bind_rows(existing_patients, as.data.frame(alloc))
  structure(alloc, combined_patients = combined, k = k)
}



testGroupTherapyAllocate = function(nrep = 100, existing, new, k, patient_id = FALSE, predict=1) {
  if(!is.numeric(nrep)) stop('nrep should be integer')
  v = replicate(nrep, groupTherapyAllocate(existing, new, k, predictability=predict) %>% select(-patient_id), simplify=FALSE)
  structure(v[!duplicated(v)], class = "testGroupTherapyAllocate")
}
print.testGroupTherapyAllocate = function(x, ...) {
  print(structure(list(
    statistic=c('number of different allocations'=length(x)), 
    method = 'Test groupTherapyAllocate', 
    data.name=deparse(substitute(x))
  ),  class="htest"))
  invisible(x)
}
